// POST /api/scan  { url, token?, mock?, installationId? }  ->  ScanReport
// GET  /api/scan?url=...&mock=1                              ->  ScanReport
//
// Private repos: pass an `installationId` (from the GitHub App), or — if the repo owner
// already has an installation stored — it's resolved automatically. Installation scans
// are persisted under that owner's org (private => billable in usage metering).

import { NextResponse } from "next/server";
import { GitHubError, parseRepoUrl } from "@/lib/github/source";
import { resolveScanAuth, scanRepository } from "@/lib/scan";
import { cacheSet, coalesceScan } from "@/lib/cache";
import { lookupCachedScan, type ScanCacheLookup } from "@/lib/scan-cache";
import { consumeScanCredit, isDbConfigured, persistScanReport } from "@/lib/db";
import { rateLimitRequest, tooManyRequests, SCAN_RATE_LIMIT } from "@/lib/rate-limit";
import { consumePublicScanQuota, refundPublicScanQuota, weeklyQuotaExceeded } from "@/lib/public-scan-quota";
import { checkScanEntitlement, isMeteredScan, paymentRequired } from "@/lib/entitlement";
import { authGateEnabled, getViewer } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STATUS: Record<GitHubError["code"], number> = {
  INVALID_URL: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  EMPTY: 422,
  UPSTREAM: 502,
};

async function runScan(
  url: string,
  opts: { token?: string; mock: boolean; installationId?: string; fresh?: boolean; peek?: boolean; signal?: AbortSignal; req?: Request },
) {
  const parsed = parseRepoUrl(url);

  // GitHub App installation token takes precedence over any explicit body token.
  let token = opts.token;
  let orgSlug = "public";
  if (!token) {
    const resolved = await resolveScanAuth(parsed, opts.installationId);
    token = resolved.token;
    orgSlug = resolved.orgSlug;
  }

  // Supabase login wall — private/org scans only. A non-public orgSlug means an installation token
  // was resolved (a private/tenant scan), which is a gated feature; anonymous public scans stay free
  // and no-signup. No-op when the gate is disabled (Supabase unconfigured / dev bypass).
  if (orgSlug !== "public" && authGateEnabled() && !(await getViewer())) {
    return NextResponse.json({ error: "Sign in to run a private scan." }, { status: 401 });
  }

  // Only cache anonymous (tokenless) scans — installation scans are per-tenant. The shared
  // lookup issues a CONDITIONAL head request (free 304 when unchanged), pins the cache key to
  // the resolved commit, then probes the in-memory + persistent (cross-instance) caches. A
  // `fresh` re-test skips the cached report but still resolves the key/ETag for the re-run.
  let lookup: ScanCacheLookup | null = null;
  if (parsed && !token) {
    lookup = await lookupCachedScan({ parsed, useLLM: !opts.mock, orgSlug: "public", fresh: opts.fresh });
    if (lookup.cached) {
      return NextResponse.json(lookup.cached, {
        headers: { "x-ascent-cache": lookup.source === "db" ? "hit-db" : "hit" },
      });
    }
  }

  // Cache-only probe: the /report page peeks for an existing snapshot of the repo's CURRENT head
  // before opening a live SSE scan, so an unchanged repo hydrates instantly instead of always
  // re-scoring from scratch. A cache miss here (or a private/unparseable repo that can't use the
  // shared anonymous cache) returns 204 — the client then falls back to streaming a fresh scan.
  if (opts.peek) {
    // Hand the head sha/etag we just resolved back to the client so the follow-up streaming scan
    // (the hot peek-miss path) can reuse them and skip a duplicate conditional head request. Only
    // present for anonymous, parseable repos (the ones that share the public cache).
    const peekHeaders: Record<string, string> = {};
    if (lookup?.headSha) {
      peekHeaders["x-ascent-head-sha"] = lookup.headSha;
      if (lookup.etag) peekHeaders["x-ascent-head-etag"] = lookup.etag;
    }
    return new NextResponse(null, { status: 204, headers: peekHeaders });
  }

  // Rate-limit the EXPENSIVE path only — a cache hit / peek above already returned for free. A
  // flood of distinct, cache-busting (?fresh=1) scans is the main cost-abuse vector; cap per-IP +
  // global LLM spend here so the cheap hydration paths stay unthrottled.
  let quotaRemaining: number | null = null;
  let quotaResetAt: number | null = null;
  let quotaScope: "anon" | "user" | null = null;
  // Set when a weekly slot was actually consumed, so the failure paths below can REFUND it — the
  // free tier meters on commit, not attempt (same policy as credit metering). Carries the viewer
  // identity the slot was charged to, so the refund recomputes the identical bucket key.
  let quotaCharged: { viewerId: string | null } | null = null;
  if (opts.req) {
    const rl = rateLimitRequest(opts.req, SCAN_RATE_LIMIT);
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

    // Weekly SOFT gate: public scans get a free per-window allowance (persistent — see
    // src/lib/public-scan-quota.ts). A SIGNED-IN viewer gets an elevated, per-user allowance; an
    // anonymous caller gets the smaller per-IP one. Only real, public scans count: a cache hit /
    // peek above already returned for free, and private (token) scans are credit-metered below.
    // Consume one slot here, on the same expensive path as the burst limiter; fails open when
    // persistence isn't configured.
    if (orgSlug === "public" && !token && !opts.mock) {
      const viewer = await getViewer();
      const quota = await consumePublicScanQuota(opts.req, { viewerId: viewer?.id });
      if (quota.enforced && !quota.allowed) return weeklyQuotaExceeded(quota);
      if (quota.enforced) {
        quotaRemaining = quota.remaining;
        quotaResetAt = quota.resetAt;
        quotaScope = quota.signedIn ? "user" : "anon";
        quotaCharged = { viewerId: viewer?.id ?? null };
      }
    }
  }
  const refundQuota = async () => {
    if (quotaCharged && opts.req) {
      await refundPublicScanQuota(opts.req, { viewerId: quotaCharged.viewerId });
      quotaCharged = null; // at most one refund per consumed slot
    }
  };

  // Entitlement gate: a private (installation-token) scan draws on the org's prepaid credits. Refuse
  // up front when the org is out of credits (and not on an unlimited plan) so we never run paid
  // inference we can't bill. Public scans and mock scans are free and skip this. The debit happens
  // after the scan actually produces real inference (below) — a dedup or a degrade-to-mock run is free.
  const metered = isMeteredScan(orgSlug, opts.mock);
  if (metered) {
    const ent = await checkScanEntitlement(orgSlug);
    if (!ent.allowed) return paymentRequired(ent.balance);
  }

  // Pass the head sha resolved for the cache key so the scored commit matches the key (no SHA
  // drift if a push lands mid-scan). Null/SHA-less lookups pass undefined → default behavior.
  const runScan = (signal?: AbortSignal) =>
    scanRepository(url, {
      token,
      mock: opts.mock,
      signal,
      headSha: lookup?.headSha ?? undefined,
    });
  // Coalesce concurrent scans of the same uncached commit (anonymous cacheable path only) onto one
  // run so two callers don't each pay a full ingest + LLM. The token (private) path is per-tenant and
  // never shared, so it scans directly.
  let report: Awaited<ReturnType<typeof scanRepository>>;
  try {
    report = lookup
      ? await coalesceScan(lookup.cacheKey, (signal) => runScan(signal), opts.signal)
      : await runScan(opts.signal);
  } catch (err) {
    // The scan delivered nothing — invalid URL / 404 / upstream failure / rate limit / client
    // abort. Refund the weekly slot before handleError maps the failure: a typo or a mid-scan
    // refresh must not burn one of the anonymous tier's 3 free slots.
    await refundQuota();
    throw err;
  }
  // Don't poison the shared `::llm` cache entry with a deterministic mock report produced by a
  // transient LLM failure: a single Gemini timeout/429 degrades to MockProvider, but the lookup
  // key is still the llm key, so caching it would pin the mock floor under `owner/repo@sha::llm`
  // for the full TTL and serve it to every later scanner of this commit. Cache only when the
  // report came from the requested engine (an intentional mock scan legitimately keys `::mock`).
  const degradedToMock = report.engine.provider === "mock" && !opts.mock;
  // A degrade-to-mock run cost no LLM inference and delivered the deterministic floor, not the
  // product the slot pays for — refund it, mirroring the credit rule ("a degrade-to-mock run is
  // free"). The quota headers below may overstate usage by this one refunded slot (soft gate).
  if (degradedToMock) await refundQuota();
  // Don't pin a low-coverage scan under the commit key for the full TTL. Per-file fetch failures
  // (raw-host hiccup / file timeouts) degrade silently to lower coverage WITHOUT failing the LLM,
  // so a transient blip would otherwise serve a degraded snapshot to every later scanner of this
  // commit. Treat low coverage like the mock-degrade case — skip caching; the next scan re-resolves.
  const lowCoverage = report.confidence < 0.5;
  if (lookup && !degradedToMock && !lowCoverage) cacheSet(lookup.cacheKey, report);

  let deduped = false;
  let persistedOk = true;
  let scanId: string | undefined;
  if (isDbConfigured()) {
    try {
      // Persist the conditional-request ETag alongside the scan so the next re-scan stays cheap.
      const persisted = await persistScanReport(report, { orgSlug, headEtag: lookup?.etag ?? undefined });
      deduped = persisted?.deduped ?? false;
      scanId = persisted?.scanId;
      if (persisted && (persisted.failures.audit || persisted.failures.contributors > 0)) {
        console.warn("[scan] persisted with partial write failures", {
          repo: parsed ? `${parsed.owner}/${parsed.repo}` : url,
          scanId: persisted.scanId,
          auditFailed: persisted.failures.audit,
          contributorFailures: persisted.failures.contributors,
        });
      }
    } catch (err) {
      // persistScanReport is atomic — a throw means the WHOLE scan rolled back and NOTHING was
      // saved. Returning a clean 200 would make the user believe it persisted (a later history /
      // permalink read then finds nothing, read as "no data" rather than "save failed"). The report
      // itself is still valid to render, so surface a degraded header rather than failing the
      // response — clients and monitoring can see the save failed (and a tracked caller can retry).
      persistedOk = false;
      console.error("[scan] persistence failed", err);
    }
  }

  // Debit one credit for a metered private scan that actually ran real inference. A degrade-to-mock
  // (transient LLM failure) produced no paid inference, so it isn't charged. Best-effort: a debit
  // hiccup must not fail a scan the user already received — it's logged for reconciliation.
  let creditsRemaining: number | null = null;
  let unbilled = false;
  if (metered && report.engine.provider !== "mock") {
    const debit = await consumeScanCredit(orgSlug, {
      repoFullName: parsed ? `${parsed.owner}/${parsed.repo}` : undefined,
      scanId,
    }).catch((err) => {
      console.error("[scan] credit debit failed", err);
      return null;
    });
    // ok:false means the atomic conditional decrement found the balance already at zero — a
    // concurrent scan won the race after our optimistic entitlement check. The inference already
    // ran and the user gets the report, but nothing was billed: surface it for reconciliation
    // rather than silently serving paid inference for free.
    if (debit && !debit.ok && !debit.unlimited) {
      unbilled = true;
      console.warn("[scan] metered scan ran but debit failed — unbilled", {
        org: orgSlug,
        repo: parsed ? `${parsed.owner}/${parsed.repo}` : url,
        scanId,
      });
    }
    if (debit) creditsRemaining = debit.balance;
  }

  // x-ascent-dedup: "hit" means this commit was already scored, so no new row was written and no
  // extra usage was billed (the report reflects the existing snapshot).
  // x-ascent-persisted: "false" means the scan was computed and returned but NOT saved (rolled back).
  // x-ascent-credits-remaining: the org's prepaid balance after this metered scan's debit.
  const headers: Record<string, string> = {
    "x-ascent-cache": "miss",
    "x-ascent-dedup": deduped ? "hit" : "miss",
  };
  if (!persistedOk) headers["x-ascent-persisted"] = "false";
  if (creditsRemaining !== null) headers["x-ascent-credits-remaining"] = String(creditsRemaining);
  // x-ascent-unbilled: the metered scan ran real inference but the debit found no credit to take
  // (lost a race with a concurrent scan) — observable signal for billing reconciliation.
  if (unbilled) headers["x-ascent-unbilled"] = "true";
  // Free public scans left in this IP's rolling weekly window (after this scan), so the UI can warn
  // before the gate trips. Only present when the weekly gate actually enforced (anonymous public).
  if (quotaRemaining !== null) headers["x-ascent-quota-remaining"] = String(quotaRemaining);
  if (quotaResetAt !== null) headers["x-ascent-quota-reset"] = String(quotaResetAt);
  if (quotaScope !== null) headers["x-ascent-quota-scope"] = quotaScope;
  return NextResponse.json(report, { headers });
}

function handleError(err: unknown) {
  if (err instanceof GitHubError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: STATUS[err.code] ?? 500 },
    );
  }
  // Client disconnected mid-scan — the scan aborted as intended (no work wasted), and no one is
  // waiting on this response. Don't log it as an unexpected failure. (499 = client closed request.)
  if (err instanceof Error && err.name === "AbortError") {
    return new NextResponse(null, { status: 499 });
  }
  console.error("[scan] unexpected error", err);
  return NextResponse.json(
    { error: "Unexpected error while scanning the repository." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      url?: string;
      token?: string;
      mock?: boolean;
      installationId?: string;
      fresh?: boolean;
    };
    if (!body.url || typeof body.url !== "string") {
      return NextResponse.json({ error: "Missing 'url' in request body." }, { status: 400 });
    }
    return await runScan(body.url, {
      token: body.token,
      mock: Boolean(body.mock),
      installationId: body.installationId,
      fresh: Boolean(body.fresh),
      signal: request.signal,
      req: request,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");
    if (!url) {
      return NextResponse.json({ error: "Missing 'url' query parameter." }, { status: 400 });
    }
    const mock = searchParams.get("mock") === "1" || searchParams.get("mock") === "true";
    const installationId = searchParams.get("installation_id") ?? undefined;
    const fresh = searchParams.get("fresh") === "1" || searchParams.get("fresh") === "true";
    const peek = searchParams.get("peek") === "1" || searchParams.get("peek") === "true";
    return await runScan(url, { mock, installationId, fresh, peek, signal: request.signal, req: request });
  } catch (err) {
    return handleError(err);
  }
}
