// POST /api/scan/stream  { url, mock?, installationId? }
// Server-Sent Events: emits `progress` events through the scan, then a `result` event
// with the final ScanReport (or an `error` event). Powers the live progress UI.

import { NextResponse } from "next/server";
import { GitHubError, parseRepoUrl } from "@/lib/github/source";
import { resolveScanAuth, scanRepository } from "@/lib/scan";
import { cacheSet, coalesceScan } from "@/lib/cache";
import { lookupCachedScan, type ScanCacheLookup } from "@/lib/scan-cache";
import { isDbConfigured, persistScanReport } from "@/lib/db";
import { rateLimitRequest, tooManyRequests, SCAN_RATE_LIMIT } from "@/lib/rate-limit";
import { consumePublicScanQuota, weeklyQuotaExceeded } from "@/lib/public-scan-quota";
import { authGateEnabled, getViewer } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    mock?: boolean;
    installationId?: string;
    fresh?: boolean;
    // Head sha/etag the /report peek already resolved, passed back to skip a duplicate head
    // lookup on the cold-report path. Honored only for anonymous, non-fresh scans.
    headSha?: string;
    headEtag?: string | null;
  };
  if (!body.url || typeof body.url !== "string") {
    return NextResponse.json({ error: "Missing 'url' in request body." }, { status: 400 });
  }

  // Rate-limit the live scan funnel (shares the per-IP/global budget with /api/scan). The /report
  // flow peeks the cache first (cheap, unthrottled); reaching the stream means a real scan.
  const rl = rateLimitRequest(request, SCAN_RATE_LIMIT);
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const url = body.url;
  const mock = Boolean(body.mock);
  const fresh = Boolean(body.fresh);
  const parsed = parseRepoUrl(url);
  const { token, orgSlug } = await resolveScanAuth(parsed, body.installationId);

  // Supabase login wall — private/org scans only (see /api/scan). A non-public orgSlug is a
  // private/tenant scan and requires sign-in; public scans stay free. Fail fast before the stream.
  if (orgSlug !== "public" && authGateEnabled() && !(await getViewer())) {
    return NextResponse.json({ error: "Sign in to run a private scan." }, { status: 401 });
  }

  // Weekly SOFT gate: public scans get a free per-window allowance (persistent — see
  // src/lib/public-scan-quota.ts). A SIGNED-IN viewer gets an elevated, per-user allowance; an
  // anonymous caller gets the smaller per-IP one. The /report flow peeks the cache first (cheap,
  // unconsumed); reaching the stream means a real scan, so consume one slot here. Fails open when
  // persistence isn't configured. Private (token) scans are credit-metered and skip this.
  let quotaRemaining: number | null = null;
  let quotaResetAt: number | null = null;
  let quotaScope: "anon" | "user" | null = null;
  if (orgSlug === "public" && !token && !mock) {
    const viewer = await getViewer();
    const quota = await consumePublicScanQuota(request, { viewerId: viewer?.id });
    if (quota.enforced && !quota.allowed) return weeklyQuotaExceeded(quota);
    if (quota.enforced) {
      quotaRemaining = quota.remaining;
      quotaResetAt = quota.resetAt;
      quotaScope = quota.signedIn ? "user" : "anon";
    }
  }

  // Hoisted so the stream's cancel() (fired when the client disconnects and tears the stream down
  // mid-scan) can stop the heartbeat immediately, rather than letting it fire on a dead controller
  // until start() unwinds. The scan itself already aborts via request.signal on the same disconnect.
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* controller closed */
        }
      };

      // Keepalive: the longest silent window is provider.assess() (between the score and
      // compose stages), which can run many seconds. Proxies/load balancers (and Vercel
      // buffering) drop idle SSE connections after ~30–60s, leaving the browser stuck mid-scan.
      // A periodic SSE comment line keeps the connection warm; it's ignored by EventSource.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          /* controller closed */
        }
      }, 15_000);

      try {
        // Conditional head lookup (free 304 when unchanged) pins the cache key to the current
        // commit, then probes the in-memory + persistent (cross-instance) caches — so an
        // unchanged repo streams instantly even on a cold instance. Only anonymous scans share
        // this public cache. A `fresh` re-test bypasses the cached report but still caches its
        // result. A failed head lookup degrades to a SHA-less best-effort key inside the helper.
        let lookup: ScanCacheLookup | null = null;
        if (parsed && !token) {
          // Reuse the head the /report peek already resolved (passed back by the client) to skip a
          // second conditional head request. Only for non-fresh scans; a fresh re-test bypasses the
          // peek entirely so no sha is sent.
          const preResolved =
            !fresh && typeof body.headSha === "string" && body.headSha
              ? { headSha: body.headSha, etag: typeof body.headEtag === "string" ? body.headEtag : null }
              : undefined;
          lookup = await lookupCachedScan({ parsed, useLLM: !mock, orgSlug: "public", fresh, preResolved });
          if (lookup.cached) {
            send("progress", {
              stage: "done",
              message: lookup.source === "db" ? "Loaded from a saved scan" : "Loaded from cache",
              pct: 100,
            });
            send("result", lookup.cached);
            return;
          }
        }

        const runScan = (signal: AbortSignal) =>
          scanRepository(url, {
            token,
            mock,
            onProgress: (p) => send("progress", p),
            // Pin the scored commit to the sha resolved for the cache key, so a push landing mid-scan
            // can't key the report under a different commit than it actually scored.
            headSha: lookup?.headSha ?? undefined,
            // Abort the scan (GitHub ingest + LLM) when the browser navigates away or aborts the SSE
            // stream, instead of running it to completion for a closed connection.
            signal,
          });
        // Coalesce concurrent scans of the same uncached commit (anonymous cacheable path only) onto a
        // single run, so a double-mount / peek-then-stream / two tabs don't each pay a full ingest+LLM.
        // The token path is per-tenant — never shared — so it scans directly.
        const report = lookup
          ? await coalesceScan(lookup.cacheKey, runScan, request.signal)
          : await runScan(request.signal);

        // A transient LLM failure degrades to MockProvider, but the lookup key is still the llm
        // key — caching it would pin the mock floor under `::llm` for the full TTL and serve it to
        // every later scanner of this commit. Skip caching a mock report when the LLM was requested.
        const degradedToMock = report.engine.provider === "mock" && !mock;
        // Don't cache a low-coverage scan: silent per-file fetch failures degrade coverage without
        // failing the LLM, so a transient blip would otherwise pin a degraded snapshot under the
        // commit key for the full TTL. Skip like the mock-degrade case; the next scan re-resolves.
        const lowCoverage = report.confidence < 0.5;
        if (lookup && !degradedToMock && !lowCoverage) cacheSet(lookup.cacheKey, report);
        if (isDbConfigured()) {
          try {
            // Persist the ETag so the next re-scan can issue a free conditional request.
            const persisted = await persistScanReport(report, { orgSlug, headEtag: lookup?.etag ?? undefined });
            if (persisted && (persisted.failures.audit || persisted.failures.contributors > 0)) {
              console.warn("[scan/stream] persisted with partial write failures", {
                repo: parsed ? `${parsed.owner}/${parsed.repo}` : url,
                scanId: persisted.scanId,
                auditFailed: persisted.failures.audit,
                contributorFailures: persisted.failures.contributors,
              });
            }
          } catch (err) {
            console.error("[scan/stream] persistence failed", err);
          }
        }
        // Stop the keepalive at the terminal frame (co-located), not only in finally, so a 15s ping
        // can't interleave after the result on a slow close.
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        send("result", report);
      } catch (err) {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        // A deliberate abort (client disconnect / scan timeout) is not a scan error to report — the
        // consumer is already gone and the scan stopped as intended. Don't emit a misleading
        // "Unexpected error" frame (the JSON route maps the same AbortError to a 499); just unwind.
        if (!(err instanceof Error && err.name === "AbortError") && !request.signal.aborted) {
          const payload =
            err instanceof GitHubError
              ? { error: err.message, code: err.code }
              : { error: "Unexpected error while scanning the repository." };
          send("error", payload);
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        try {
          controller.close();
        } catch {
          /* already closed — e.g. the client disconnected and the stream was torn down */
        }
      }
    },
    // Client disconnected and tore the stream down while start() is still mid-scan. Stop the
    // heartbeat now so it can't keep firing on a dead controller; the in-flight scan is already
    // wired to request.signal (aborts on the same disconnect) and unwinds via start()'s finally.
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
      // Free public scans left in this IP's rolling weekly window (after this scan), plus when the
      // window resets; only set when the weekly gate enforced (anonymous public). Lets the client
      // warn before the gate trips.
      ...(quotaRemaining !== null ? { "x-ascent-quota-remaining": String(quotaRemaining) } : {}),
      ...(quotaResetAt !== null ? { "x-ascent-quota-reset": String(quotaResetAt) } : {}),
      ...(quotaScope !== null ? { "x-ascent-quota-scope": quotaScope } : {}),
    },
  });
}
