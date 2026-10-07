// POST /api/scan  { url, token?, mock?, installationId? }  ->  ScanReport
// GET  /api/scan?url=...&mock=1                              ->  ScanReport
//
// Private repos: pass an `installationId` (from the GitHub App), or — if the repo owner
// already has an installation stored — it's resolved automatically. Installation scans
// are persisted under that owner's org (private => billable in usage metering).
//
// THE JSON ADAPTER over `src/lib/scan-lifecycle.ts`. Everything from the coordinate to the persisted
// report lives there, in ONE copy shared with /api/scan/stream; this file owns the protocol (a JSON
// body plus the x-ascent-* headers) and its own gate PLACEMENT: the four pre-scan gates run in the
// lifecycle's `preScan` slot, AFTER the free cache-hit / peek / salvage returns, so hydrating a saved
// report stays unthrottled and still costs nothing.

import { NextResponse } from "next/server";
import { GitHubError } from "@/lib/github/source";
import { githubErrorHeaders, githubErrorStatus } from "@/lib/api/github-status";
import { respondError } from "@/lib/api/respond";
import { resolveScanAuth } from "@/lib/scan";
import { isPersistedScanFresh } from "@/lib/scan-cache";
import { resolveScanScope, UNSCOPED, type ResolvedScanScope } from "@/lib/scan-scope-server";
import { recordQuotaEvent } from "@/lib/db";
import { rateLimitRequest, tooManyRequests, PEEK_RATE_LIMIT } from "@/lib/rate-limit";
import { scanAuthGate, scanCreditGate, scanRateLimitGate } from "@/lib/scan-gates";
import type { QuotaScope } from "@/lib/public-scan-quota";
import { consumeScanQuota } from "@/lib/scan-finalize";
import {
  INVALID_SCAN_URL,
  createScanRefundLedger,
  latestPublicReport,
  resolveScanCoordinate,
  runScanLifecycle,
  type ScanCreditHoldLike,
} from "@/lib/scan-lifecycle";
import { scanCreditRefusal } from "@/lib/entitlement";
import { authGateEnabled, getViewer } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300s (Vercel's max on Pro): a live Gemini-Flash scan plus the in-request completion email must fit
// inside one function invocation. The client backstop (SCAN_CLIENT_TIMEOUT_MS) sits above this.
export const maxDuration = 300;

// The STATUS record that used to live here moved to @/lib/api/github-status, unchanged in every
// value — practices/generate mapped the SAME error class by `err.status ?? 502` and disagreed with
// this route on EMPTY, INVALID_URL and RATE_LIMITED. One mapping now, this one.

async function runScan(
  url: string,
  opts: {
    token?: string;
    mock: boolean;
    installationId?: string;
    fresh?: boolean;
    peek?: boolean;
    recent?: boolean;
    latest?: boolean;
    signal?: AbortSignal;
    req?: Request;
    /** Optional SCOPE (G7-07 / G7-08): a git ref to score instead of the default branch, and/or a
     *  monorepo sub-path to aim the ingestion budget at. Validated + resolved server-side. */
    ref?: string;
    subPath?: string;
  },
): Promise<Response> {
  // FORGE COORDINATE — shared with /api/scan/stream via resolveScanCoordinate.
  const coordinate = resolveScanCoordinate(url);
  const { parsed, ghParsed, forgeId } = coordinate;

  // GitHub App installation token takes precedence over any explicit body token.
  let token = opts.token;
  let orgSlug = "public";
  // Set when the owner is an installed org the caller may NOT mint for: ingesting it with the ambient
  // operator PAT would leak the private repo the mint gate just denied. Token-less ⇒ private repos 404.
  let noAmbientToken = false;
  if (!token) {
    const resolved = await resolveScanAuth(ghParsed, opts.installationId);
    token = resolved.token;
    orgSlug = resolved.orgSlug;
    // A non-GitHub coordinate must NEVER reach the ambient GITHUB_TOKEN: it would be a GitHub
    // credential sent to another forge's host.
    noAmbientToken = (resolved.noAmbientToken ?? false) || forgeId !== "github";
  }

  // Supabase login wall — private/org scans only. A non-public orgSlug means an installation token
  // was resolved (a private/tenant scan), which is a gated feature; anonymous public scans stay free
  // and no-signup. No-op when the gate is disabled (Supabase unconfigured / dev bypass).
  //
  // G8-49 — this is the ONE gate that deliberately still precedes the burst limiter, so an anonymous
  // caller who supplies an `installationId` for an installed org gets 401 here where the stream would
  // answer 429. Not an oversight: the limiter cannot move above it (it must sit after the free
  // cache/peek returns, which need the resolved token), so unifying would mean moving THIS wall down
  // past the scope resolve below — and that would let an unauthenticated caller drive a GitHub ref
  // resolve against a PRIVATE repo through the installation token, confirming which branches exist.
  // A private-repo existence oracle is a worse outcome than a status-code difference on a request that
  // is rejected either way. The public funnel — every anonymous scan — is fully unified below.
  if (orgSlug !== "public" && authGateEnabled() && !(await getViewer())) {
    return NextResponse.json({ error: "Sign in to run a private scan." }, { status: 401 });
  }

  // Throttle the cache-only "peek" hydration probe too. The cache lookup inside the lifecycle issues a
  // GitHub head request — a REAL, non-304 one for a never-before-seen repo — against the operator PAT,
  // plus 1-2 DB reads, before the peek returns 204. That is cheap per request but an anonymous client
  // looping distinct repo URLs can exhaust the shared GitHub budget at no cost to itself. Cap the peek
  // path on its own generous budget (PEEK_RATE_LIMIT) WITHOUT consuming the monthly free-scan quota.
  // Must run BEFORE the lifecycle so the head request itself is rate-limited, not just the 204.
  if (opts.peek && opts.req) {
    const rl = rateLimitRequest(opts.req, PEEK_RATE_LIMIT);
    if (!rl.ok) {
      void recordQuotaEvent("rate_limit", "scan").catch(() => {}); // observability on the throttled peek path
      // Whole result: the peek limiter is per-IP and in-memory, so the refusal can honestly state
      // the caller's own budget and window — the client meter polling this path can then back off
      // to a rate that fits instead of guessing from a bare Retry-After.
      return tooManyRequests(rl);
    }
  }

  // SCOPE (G7-07 / G7-08). Resolved here rather than inside the lifecycle because its refusal is a
  // plain status both routes render identically (and the stream needs it before its stream opens).
  // `noAmbientToken` is honored so a ref resolve can't confirm a private repo's branches through the
  // operator PAT. See scan-scope-server.ts for the collision/trust reasoning.
  const scopeToken = token ?? (noAmbientToken ? undefined : process.env.GITHUB_TOKEN);
  const scoping: ResolvedScanScope = ghParsed
    ? await resolveScanScope(ghParsed, { ref: opts.ref, subPath: opts.subPath }, { token: scopeToken })
    : UNSCOPED;
  if (scoping.error) {
    return NextResponse.json({ error: scoping.error.message, code: scoping.error.code }, { status: scoping.error.status });
  }

  // Quota + credit state, captured from the gates that run in the `preScan` slot below so the response
  // headers can report them. The refund thunks are read THROUGH these bindings by the ledger, which is
  // why a gate that runs later than the ledger's construction still refunds correctly.
  let quotaRemaining: number | null = null;
  let quotaResetAt: number | null = null;
  let quotaScope: QuotaScope | null = null;
  let refundQuota = async () => {};
  let hold: ScanCreditHoldLike = { remaining: null, refund: async () => {} };
  // Individual tier (decision 5). Resolved in the gate slot below (getViewer is request-cached) and
  // read back through the lifecycle's thunk, so the public funnel resolves nothing until it must.
  let decisionOrgSlug: string | undefined;
  const ledger = createScanRefundLedger({
    refundQuota: () => refundQuota(),
    refundCredit: () => hold.refund(),
  });

  return runScanLifecycle<Response>(
    {
      url,
      coordinate,
      orgSlug,
      token,
      noAmbientToken,
      scoping,
      mock: opts.mock,
      fresh: Boolean(opts.fresh),
      signal: opts.signal,
      resolveDecisionOrgSlug: () => decisionOrgSlug,
      ledger,
    },
    {
      tag: "scan",
      deliverCached: (report, source) =>
        NextResponse.json(report, { headers: { "x-ascent-cache": source === "db" ? "hit-db" : "hit" } }),

      // THE GATE SLOT. The peek/salvage returns, the INVALID_URL answer and the four pre-scan gates,
      // in the one position this route needs them: after the free cache hit above (so hydration is
      // unthrottled) and before any inference.
      preScan: async (target) => {
        // Cache-only probe: the /report page peeks for an existing snapshot of the repo's CURRENT head
        // before opening a live SSE scan, so an unchanged repo hydrates instantly. A cache miss here
        // (or a private/unparseable repo that can't use the shared anonymous cache) returns 204 — the
        // client then falls back to streaming a fresh scan.
        if (opts.peek) {
          // A SCOPED peek has nothing correct to return: the shared caches and the persisted corpus
          // only ever hold whole-repo, default-branch readings. 204 → the client goes straight to a
          // live scoped scan.
          if (target.scoped) return new NextResponse(null, { status: 204 });
          // Hand the head sha/etag the lifecycle just resolved back to the client so the follow-up
          // streaming scan (the hot peek-miss path) can reuse them and skip a duplicate conditional
          // head request. Only present for anonymous, parseable repos (the ones that share the cache).
          const peekHeaders: Record<string, string> = {};
          if (target.lookup?.headSha) {
            peekHeaders["x-ascent-head-sha"] = target.lookup.headSha;
            if (target.lookup.etag) peekHeaders["x-ascent-head-etag"] = target.lookup.etag;
          }
          // Any-commit fallback: the head-pinned lookup missed (the head moved, or no snapshot of the
          // current commit), but this repo's most recent PERSISTED report can still be served instead
          // of forcing a fresh multi-minute scan — one DB read, zero GitHub/LLM cost, still cache-only.
          // Two callers, one read (latestPublicReport, shared with the failure salvage):
          //   • recent (peek=1&recent=1, the normal /report peek): serve ONLY within the cache-age
          //     window (scanMaxCacheAgeMs, ~7d). x-ascent-cache=hit-recent marks it.
          //   • latest (peek=1&latest=1, the quota-blocked salvage): serve the most recent report at
          //     ANY age, so a quota wall shows the last reading rather than a dead end.
          // Both: anonymous public funnel only, never a private snapshot. x-ascent-stale flags that the
          // served report isn't head-fresh, so the report UI's "Re-test" still forces a re-score.
          if (opts.recent || opts.latest) {
            const last = await latestPublicReport(ghParsed, token);
            if (last) {
              const recentHit = opts.recent && isPersistedScanFresh(last.scannedAt);
              if (recentHit || opts.latest) {
                const headers: Record<string, string> = { ...peekHeaders, "x-ascent-stale": "true" };
                if (recentHit) headers["x-ascent-cache"] = "hit-recent";
                return NextResponse.json(last, { headers });
              }
            }
          }
          return new NextResponse(null, { status: 204, headers: peekHeaders });
        }

        // Reject a provably-invalid URL BEFORE the quota block below — the same body the stream answers
        // (INVALID_SCAN_URL). scanRepository would throw INVALID_URL anyway, but only AFTER the monthly
        // slot was consumed, and the refund for that is fail-open: a refund-write hiccup would
        // permanently burn one of the anonymous tier's free slots for a typo. Placed after the
        // peek/salvage returns above so a cache probe keeps its cheap 204 contract. (G3-18)
        if (!parsed) return NextResponse.json(INVALID_SCAN_URL, { status: 400 });

        // ── PRE-SCAN GATES: rate limit → sign-in wall → quota → credit ─────────────────────────────
        // This ORDER IS UNIFIED with /api/scan/stream (G8-49). It used to be sign-in wall → rate limit
        // here and rate limit → sign-in wall there, so one throttled anonymous request got 401 from
        // this route and 429 from the other, and only the stream recorded the `rate_limit` quota event.
        // The limiter is the cheaper, more truthful answer, signing in does not lift a burst limit, and
        // a 401 sends a throttled caller into a sign-in flow that cannot help. See scan-gates.ts.
        //
        // What is preserved from the old order is the PLACEMENT, not the sequence: the limiter still
        // sits AFTER the free cache-hit / peek / salvage returns above, so hydrating a saved report is
        // still unthrottled and still costs nothing.
        if (opts.req) {
          const rl = await scanRateLimitGate(opts.req);
          if (!rl.ok) return tooManyRequests(rl.rl); // the whole result: these two are the only routes on the shared scan budget, so a global refusal must say so
        }

        // UAT TOMAS-L1-01 — the anonymous PUBLIC funnel is exempt (see scan-gates.ts).
        // `orgSlug === "public"` with no caller-supplied body token means no token at all is in play,
        // so an exempted scan cannot reach a private repo; the private/org wall above still answers
        // those, and this path stays bounded by the burst limiter above and the monthly quota below.
        const authGate = await scanAuthGate(getViewer, { publicScan: orgSlug === "public" && !token });
        if (!authGate.ok) {
          return NextResponse.json({ error: "Sign in to run a scan.", code: "auth_required" }, { status: 401 });
        }

        if (opts.req) {
          // Monthly SOFT gate (rolling 30-day window, default 5 — src/lib/public-scan-quota.ts is the
          // single source of truth): public scans get a free per-window allowance, shared with
          // /api/scan/stream via consumeScanQuota. A cache hit / peek above already returned for free;
          // private (token) scans are credit-metered below.
          const quota = await consumeScanQuota(opts.req, { orgSlug, token, mock: opts.mock });
          if (quota.blocked) return quota.blocked;
          quotaRemaining = quota.quotaRemaining;
          quotaResetAt = quota.quotaResetAt;
          quotaScope = quota.quotaScope;
          refundQuota = quota.refund;
        }

        // Entitlement gate + credit RESERVATION: a private (installation-token) scan draws on the org's
        // prepaid credits. Public and mock scans are free and skip it. Shared with /api/scan/stream via
        // scanCreditGate — this block used to live inline HERE ONLY, which is how the stream route (the
        // one the report UI actually drives) came to run paid inference with no meter at all. The
        // reserve is sequenced LAST on both routes; see scan-gates.ts for why.
        const credit = await scanCreditGate(orgSlug, {
          mock: opts.mock,
          repoFullName: coordinate.repoIdentity,
          // Attribution for the ledger row. A metered scan is a PRIVATE/org scan, which the sign-in
          // wall above already required a viewer for; the thunk keeps the resolve off the public
          // funnel, and getViewer is request-cached so it costs nothing here.
          resolveActor: async () => (await getViewer())?.login ?? null,
        });
        if (!credit.ok) return scanCreditRefusal(credit);
        hold = credit.hold;

        // Individual tier (decision 5): a signed-in viewer's public-funnel scan reads THEIR personal-org
        // standing decisions into the prompt; org/private scans keep org scoping. getViewer is
        // request-cached, so this re-resolve after the gates above is free.
        if (orgSlug === "public") {
          const decisionViewer = await getViewer();
          if (decisionViewer) decisionOrgSlug = decisionViewer.login.trim().toLowerCase();
        }
        return null;
      },

      deliverResult: (report, outcome) => {
        // x-ascent-dedup: "hit" means this commit was already scored, so no new row was written and the
        // reserved credit was refunded (the report reflects the existing snapshot).
        // x-ascent-persisted: "false" means the scan was computed and returned but NOT saved.
        // x-ascent-credits-remaining: the org's prepaid balance after reservation/refund.
        const headers: Record<string, string> = {
          "x-ascent-cache": "miss",
          "x-ascent-dedup": outcome.deduped ? "hit" : "miss",
        };
        if (!outcome.persistedOk) headers["x-ascent-persisted"] = "false";
        if (hold.remaining !== null) headers["x-ascent-credits-remaining"] = String(hold.remaining);
        // Free public scans left in this bucket's rolling 30-day window (after this scan), so the UI can
        // warn before the gate trips. Only present when the monthly gate actually enforced.
        if (quotaRemaining !== null) headers["x-ascent-quota-remaining"] = String(quotaRemaining);
        if (quotaResetAt !== null) headers["x-ascent-quota-reset"] = String(quotaResetAt);
        if (quotaScope !== null) headers["x-ascent-quota-scope"] = quotaScope;
        return NextResponse.json(report, { headers });
      },

      deliverFailure: (err, salvaged) => {
        // ERROR SALVAGE, shared with /api/scan/stream: when a live scan FAILS (transient upstream /
        // LLM / rate limit) but we've scored this repo before, serve the most recent persisted report
        // instead of a hard error. The lifecycle owns which failures qualify (never a client abort,
        // never a scoped scan, never a private snapshot), so the two entry points cannot disagree.
        if (salvaged) {
          return NextResponse.json(salvaged, {
            headers: { "x-ascent-cache": "miss", "x-ascent-stale": "true", "x-ascent-fallback": "error" },
          });
        }
        throw err; // POST/GET map it through handleError, which owns this route's statuses
      },
    },
  );
}

function handleError(err: unknown) {
  if (err instanceof GitHubError) {
    // Surface GitHub's Retry-After on a (secondary) rate limit so the client can back off instead of
    // hammering — paired with the secondary-limit classification in ghJson (github-repo-data-access #2).
    // A GitHubError is a KNOWN upstream outcome, not a defect, so it is answered without a `cause`:
    // reporting every rate limit would be exactly the noise that trains people to ignore Sentry.
    return respondError(githubErrorStatus(err), err.message, {
      code: err.code,
      headers: githubErrorHeaders(err),
    });
  }
  // Client disconnected mid-scan — the scan aborted as intended (no work wasted), and no one is
  // waiting on this response. Don't log it as an unexpected failure. (499 = client closed request.)
  if (err instanceof Error && err.name === "AbortError") {
    return new NextResponse(null, { status: 499 });
  }
  console.error("[scan] unexpected error", err);
  // Passing `cause` is what closes the inversion: this path caught the error, so onRequestError will
  // never see it, and until now the most expensive route in the app failed silently in production.
  return respondError(500, "Unexpected error while scanning the repository.", { cause: err });
}

export async function POST(request: Request) {
  try {
    // silent by design: an unparseable body has no `url`, which answers 400 just below
    const body = (await request.json().catch(() => ({}))) as {
      url?: string;
      token?: string;
      mock?: boolean;
      installationId?: string;
      fresh?: boolean;
      // Optional scope — a git ref to score instead of the default branch, and/or a monorepo sub-path.
      ref?: string;
      subPath?: string;
    };
    if (!body.url || typeof body.url !== "string") {
      return NextResponse.json({ error: "Missing 'url' in request body." }, { status: 400 });
    }
    return await runScan(body.url, {
      token: body.token,
      mock: Boolean(body.mock),
      installationId: body.installationId,
      fresh: Boolean(body.fresh),
      ref: typeof body.ref === "string" ? body.ref : undefined,
      subPath: typeof body.subPath === "string" ? body.subPath : undefined,
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
    // `recent=1` (peek-only) allows serving the most recent persisted report when it's within the
    // cache-age window (~7d), even if the head moved — the recency cache that avoids a repeat scan.
    const recent = searchParams.get("recent") === "1" || searchParams.get("recent") === "true";
    // `latest=1` (peek-only) allows falling back to the most recent persisted report of ANY
    // commit when the head-pinned probe misses — used by the quota-blocked salvage path.
    const latest = searchParams.get("latest") === "1" || searchParams.get("latest") === "true";
    // GET is restricted to the CHEAP idempotent modes it exists for (cache peeks and ?mock=1 demos).
    // A bare GET /api/scan?url=… used to run the identical quota-consuming, credit-metering,
    // report-persisting path as POST — but GETs are exactly the requests prefetchers, link expanders,
    // crawlers, and browser URL-bar autocompletion replay, and they carry the session cookie, so a
    // signed-in user's own browser could silently re-fire a full scan (burning free-tier slots or org
    // credits with no UI shown; the refund machinery only covers FAILED scans, not unwanted successful
    // ones). Nothing in-app links a real scan-on-GET — the report flow peeks here then POSTs to
    // /api/scan/stream. Unbounded-cost mutations belong on POST. (scan-pipeline-ingestion #5)
    if (!peek && !mock) {
      return NextResponse.json(
        {
          error:
            "A real scan is not served on GET (prefetchers/crawlers replay GETs, and a scan spends quota and money). POST /api/scan with { url } instead, or use GET with peek=1 (cache probe) or mock=1 (deterministic demo).",
        },
        { status: 405, headers: { allow: "POST", "cache-control": "no-store" } },
      );
    }
    // Scope params are accepted on GET too, but only reach a real scan in the ?mock=1 demo mode (the
    // guard above restricts GET to peek/mock); a scoped peek short-circuits to 204 inside runScan.
    const ref = searchParams.get("ref") ?? undefined;
    const subPath = searchParams.get("path") ?? undefined;
    return await runScan(url, { mock, installationId, fresh, peek, recent, latest, ref, subPath, signal: request.signal, req: request });
  } catch (err) {
    return handleError(err);
  }
}
