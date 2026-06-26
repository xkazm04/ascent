// POST /api/scan  { url, token?, mock?, installationId? }  ->  ScanReport
// GET  /api/scan?url=...&mock=1                              ->  ScanReport
//
// Private repos: pass an `installationId` (from the GitHub App), or — if the repo owner
// already has an installation stored — it's resolved automatically. Installation scans
// are persisted under that owner's org (private => billable in usage metering).

import { NextResponse } from "next/server";
import { GitHubError, parseRepoUrl } from "@/lib/github/source";
import { resolveScanAuth, scanRepository } from "@/lib/scan";
import { coalesceScan } from "@/lib/cache";
import { lookupCachedScan, type ScanCacheLookup } from "@/lib/scan-cache";
import { consumeScanCredit, CREDIT_REASON, getScanReportByCommit, grantCredits, recordQuotaEvent } from "@/lib/db";
import { rateLimitRequest, tooManyRequests, SCAN_RATE_LIMIT, PEEK_RATE_LIMIT } from "@/lib/rate-limit";
import { cacheAndPersistScan, classifyScanResult, consumeScanQuota } from "@/lib/scan-finalize";
import { checkScanEntitlement, isMeteredScan, paymentRequired } from "@/lib/entitlement";
import { maybeAlertLowCredits } from "@/lib/scan-alerts";
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
  opts: { token?: string; mock: boolean; installationId?: string; fresh?: boolean; peek?: boolean; latest?: boolean; signal?: AbortSignal; req?: Request },
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

  // Throttle the cache-only "peek" hydration probe too. The cache lookup below issues a GitHub head
  // request — a REAL, non-304 one for a never-before-seen repo — against the operator PAT, plus 1-2 DB
  // reads, before the peek returns 204. That is cheap per request but an anonymous client looping
  // distinct repo URLs can exhaust the shared GitHub budget at no cost to itself. Cap the peek path on
  // its own generous budget (PEEK_RATE_LIMIT) WITHOUT consuming the weekly free-scan quota; the
  // expensive full-scan path keeps its stricter limiter + quota below. Must run BEFORE the cache lookup
  // so the head request itself is rate-limited, not just the 204.
  if (opts.peek && opts.req) {
    const rl = rateLimitRequest(opts.req, PEEK_RATE_LIMIT);
    if (!rl.ok) {
      void recordQuotaEvent("rate_limit", "scan").catch(() => {}); // observability on the throttled peek path
      return tooManyRequests(rl.retryAfterSec);
    }
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
    // Any-commit fallback (peek=1&latest=1): the head-pinned lookup above missed, but a
    // quota-blocked client can still be served this repo's most recent PERSISTED report instead
    // of a dead-end wall — one DB read, zero GitHub/LLM cost, still cache-only (never scans).
    // Anonymous public funnel only (token scans are per-tenant and never quota-blocked), and the
    // report must not be private (same defense-in-depth gate as the badge: the shared store could
    // in principle hold a private snapshot). x-ascent-stale flags that it isn't head-fresh.
    if (opts.latest && parsed && !token) {
      const last = await getScanReportByCommit(parsed.owner, parsed.repo, {}).catch(() => null);
      if (last && !last.repo.isPrivate) {
        return NextResponse.json(last, { headers: { ...peekHeaders, "x-ascent-stale": "true" } });
      }
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
  // free tier meters on commit, not attempt (same policy as credit metering).
  let refundQuota = async () => {};
  if (opts.req) {
    const rl = rateLimitRequest(opts.req, SCAN_RATE_LIMIT);
    if (!rl.ok) {
      void recordQuotaEvent("rate_limit", "scan").catch(() => {}); // QUOTA #2: observability on the costly scan path
      return tooManyRequests(rl.retryAfterSec);
    }

    // Weekly SOFT gate: public scans get a free per-window allowance (shared with /api/scan/stream via
    // consumeScanQuota). A cache hit / peek above already returned for free; private (token) scans are
    // credit-metered below. Consume one slot here, on the same expensive path as the burst limiter.
    const quota = await consumeScanQuota(opts.req, { orgSlug, token, mock: opts.mock });
    if (quota.blocked) return quota.blocked;
    quotaRemaining = quota.quotaRemaining;
    quotaResetAt = quota.quotaResetAt;
    quotaScope = quota.quotaScope;
    refundQuota = quota.refund;
  }

  // Entitlement gate: a private (installation-token) scan draws on the org's prepaid credits. Public
  // and mock scans are free and skip this.
  const metered = isMeteredScan(orgSlug, opts.mock);
  let creditsRemaining: number | null = null;
  let creditReserved = false;
  if (metered) {
    const ent = await checkScanEntitlement(orgSlug);
    if (!ent.allowed) return paymentRequired(ent.balance);
    if (!ent.unlimited) {
      // RESERVE one credit BEFORE running paid inference (mirrors /api/org/scan and /api/cron/rescan).
      // checkScanEntitlement is a point-in-time read two concurrent scans both pass, so the old
      // "scan first, debit after" ordering let the loser run real LLM inference and then fail to debit
      // — a paid scan served free (the `unbilled` branch). consumeScanCredit's atomic conditional
      // decrement makes the reservation the real gate; refunded below on degrade-to-mock / dedup / throw.
      const res = await consumeScanCredit(orgSlug, {
        repoFullName: parsed ? `${parsed.owner}/${parsed.repo}` : undefined,
      }).catch(() => null);
      if (!res || (!res.unlimited && !res.ok)) return paymentRequired(res?.balance ?? ent.balance);
      // `charged` is true ONLY on an overflow credit debit — within-allowance scans are free and must
      // NOT be refunded later (that would mint a credit), so the reservation flag tracks charged, not ok.
      creditReserved = res.charged;
      creditsRemaining = res.balance;
      if (creditReserved) await maybeAlertLowCredits(orgSlug, res.balance);
    }
  }
  // Refund the reservation when nothing billable was produced (degrade-to-mock / dedup / throw). Updates
  // the post-refund balance so the response header stays accurate. Idempotent via the `creditReserved` flag.
  const refundCredit = async () => {
    if (creditReserved) {
      creditReserved = false;
      const bal = await grantCredits(orgSlug, 1, { reason: CREDIT_REASON.REFUND, actor: "system" }).catch(() => null);
      if (typeof bal === "number") creditsRemaining = bal;
    }
  };

  // Pass the head sha resolved for the cache key so the scored commit matches the key (no SHA
  // drift if a push lands mid-scan). Null/SHA-less lookups pass undefined → default behavior.
  const doScan = (signal?: AbortSignal) =>
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
      ? await coalesceScan(lookup.cacheKey, (signal) => doScan(signal), opts.signal)
      : await doScan(opts.signal);
  } catch (err) {
    // The scan delivered nothing — invalid URL / 404 / upstream failure / rate limit / client
    // abort. Refund both the weekly slot AND any reserved credit before handleError maps the failure:
    // a typo or a mid-scan refresh must not burn a free slot or a prepaid credit.
    await refundQuota();
    await refundCredit();
    // Error fallback: when a live scan FAILS (transient upstream/LLM/rate-limit) but we've scored this
    // repo before, serve the most recent persisted report instead of a hard error — the same any-commit
    // salvage the quota wall uses (peek&latest). Anonymous public, parseable repos only (token scans are
    // per-tenant and never share this store); never on a client abort (no one is waiting); never a
    // private snapshot (defense-in-depth on the shared store). x-ascent-stale + x-ascent-fallback flag it.
    if (parsed && !token && !(err instanceof Error && err.name === "AbortError")) {
      const last = await getScanReportByCommit(parsed.owner, parsed.repo, {}).catch(() => null);
      if (last && !last.repo.isPrivate) {
        return NextResponse.json(last, {
          headers: { "x-ascent-cache": "miss", "x-ascent-stale": "true", "x-ascent-fallback": "error" },
        });
      }
    }
    throw err;
  }
  // Derive the cache-poisoning guards (degrade-to-mock / low-coverage) — shared with /api/scan/stream
  // via classifyScanResult. degradedToMock: a transient LLM failure fell back to MockProvider but the
  // lookup key is still ::llm, so caching/persisting it would pin the deterministic floor for the full
  // TTL and serve it to every later scanner of this commit. lowCoverage: silent per-file fetch failures
  // degrade coverage without failing the LLM — treat the same way.
  // A caller-supplied body token can scan a PRIVATE repo while orgSlug is still the shared "public"
  // funnel (orgSlug is only resolved on the token-LESS branch above). Persisting that under "public"
  // would publish the private report to every anonymous visitor (the report page + history read the
  // public org). Re-tenant a private body-token scan under the repo OWNER's org so it is stored
  // privately — only readable by someone with that installation — never in the public corpus. The
  // persist-side guard refuses public+private regardless; this is the correct-placement half.
  if (opts.token && parsed && report.repo.isPrivate && orgSlug === "public") {
    orgSlug = report.repo.owner.trim().toLowerCase() || parsed.owner.toLowerCase();
  }

  const { degradedToMock, lowCoverage } = classifyScanResult(report, opts.mock);
  // A degrade-to-mock run cost no LLM inference and delivered the deterministic floor, not the
  // product the slot pays for — refund both the weekly slot and any reserved credit ("a degrade-to-mock
  // run is free"). The quota headers below may overstate usage by this one refunded slot (soft gate).
  if (degradedToMock) {
    await refundQuota();
    await refundCredit();
  }
  // Cache + persist behind the shared guards: skip BOTH the in-memory cache and the durable store on a
  // degraded/low-coverage report (lookupCachedScan's DB tier would otherwise re-serve the floor cross-
  // instance under ::llm — the same poisoning the cacheSet skip prevents). `persistedOk` is false when
  // the atomic persist threw and rolled the whole scan back (surfaced as a degraded response header).
  const { deduped, persistedOk } = await cacheAndPersistScan(report, { degradedToMock, lowCoverage }, {
    tag: "scan",
    repo: parsed ? `${parsed.owner}/${parsed.repo}` : url,
    orgSlug,
    lookup,
  });

  // The credit was RESERVED before inference (above). Refund it when this commit was already scored
  // (`deduped` — no new scored row), mirroring /api/org/scan and cron rescan ("a dedup run is free").
  // degrade-to-mock and throw already refunded above. A real, newly-scored metered scan keeps its charge.
  if (deduped) await refundCredit();

  // x-ascent-dedup: "hit" means this commit was already scored, so no new row was written and the
  // reserved credit was refunded (the report reflects the existing snapshot).
  // x-ascent-persisted: "false" means the scan was computed and returned but NOT saved (rolled back).
  // x-ascent-credits-remaining: the org's prepaid balance after this metered scan's reservation/refund.
  const headers: Record<string, string> = {
    "x-ascent-cache": "miss",
    "x-ascent-dedup": deduped ? "hit" : "miss",
  };
  if (!persistedOk) headers["x-ascent-persisted"] = "false";
  if (creditsRemaining !== null) headers["x-ascent-credits-remaining"] = String(creditsRemaining);
  // Free public scans left in this IP's rolling weekly window (after this scan), so the UI can warn
  // before the gate trips. Only present when the weekly gate actually enforced (anonymous public).
  if (quotaRemaining !== null) headers["x-ascent-quota-remaining"] = String(quotaRemaining);
  if (quotaResetAt !== null) headers["x-ascent-quota-reset"] = String(quotaResetAt);
  if (quotaScope !== null) headers["x-ascent-quota-scope"] = quotaScope;
  return NextResponse.json(report, { headers });
}

function handleError(err: unknown) {
  if (err instanceof GitHubError) {
    // Surface GitHub's Retry-After on a (secondary) rate limit so the client can back off instead of
    // hammering — paired with the secondary-limit classification in ghJson (github-repo-data-access #2).
    const headers = err.retryAfterSec ? { "retry-after": String(err.retryAfterSec) } : undefined;
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: STATUS[err.code] ?? 500, headers },
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
    // `latest=1` (peek-only) allows falling back to the most recent persisted report of ANY
    // commit when the head-pinned probe misses — used by the quota-blocked salvage path.
    const latest = searchParams.get("latest") === "1" || searchParams.get("latest") === "true";
    return await runScan(url, { mock, installationId, fresh, peek, latest, signal: request.signal, req: request });
  } catch (err) {
    return handleError(err);
  }
}
