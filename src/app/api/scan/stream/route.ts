// POST /api/scan/stream  { url, mock?, installationId? }
// Server-Sent Events: emits `progress` events through the scan, then a `result` event
// with the final ScanReport (or an `error` event). Powers the live progress UI.

import { NextResponse } from "next/server";
import { GitHubError, parseRepoUrl } from "@/lib/github/source";
import { resolveScanAuth, scanRepository } from "@/lib/scan";
import { coalesceScan } from "@/lib/cache";
import { lookupCachedScan, type ScanCacheLookup } from "@/lib/scan-cache";
import { recordQuotaEvent } from "@/lib/db";
import { rateLimitRequest, tooManyRequests, SCAN_RATE_LIMIT } from "@/lib/rate-limit";
import { cacheAndPersistScan, classifyScanResult, consumeScanQuota } from "@/lib/scan-finalize";
import { authGateEnabled, getViewer } from "@/lib/access";
import { publicBaseUrl } from "@/lib/site";
import { reportPermalink } from "@/lib/ui";
import { dispatchScanCompletionEmail, isValidEmail } from "@/lib/email";
import { SSE_HEADERS, makeSseSend } from "@/lib/sse-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300s (Vercel's max on Pro): a live Gemini-Flash scan plus the in-request completion email must fit
// inside one function invocation. The client backstop (SCAN_CLIENT_TIMEOUT_MS) sits above this.
export const maxDuration = 300;

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
    // "Email me when it's done" opt-in. `email` is a custom recipient used ONLY when the signed-in
    // account has no email; otherwise the trusted viewer email is used (see the send below).
    notify?: boolean;
    email?: string;
  };
  if (!body.url || typeof body.url !== "string") {
    return NextResponse.json({ error: "Missing 'url' in request body." }, { status: 400 });
  }

  // Rate-limit the live scan funnel (shares the per-IP/global budget with /api/scan). The /report
  // flow peeks the cache first (cheap, unthrottled); reaching the stream means a real scan.
  const rl = rateLimitRequest(request, SCAN_RATE_LIMIT);
  if (!rl.ok) {
    void recordQuotaEvent("rate_limit", "scan").catch(() => {}); // QUOTA #2: observability on the costly scan path
    return tooManyRequests(rl.retryAfterSec);
  }

  const url = body.url;
  const mock = Boolean(body.mock);
  const fresh = Boolean(body.fresh);
  const parsed = parseRepoUrl(url);
  // Reject a provably-invalid URL BEFORE the quota block below: scanRepository would throw
  // INVALID_URL anyway, but only after the weekly slot was consumed — a typo must not burn one of
  // the anonymous tier's free slots. Mirrors the JSON route's INVALID_URL → 400 mapping.
  if (!parsed) {
    return NextResponse.json(
      { error: "Enter a valid GitHub repository URL, e.g. https://github.com/owner/repo.", code: "INVALID_URL" },
      { status: 400 },
    );
  }
  const { token, orgSlug } = await resolveScanAuth(parsed, body.installationId);

  // Supabase login wall. In production (Supabase configured + bypass hard-off, via authGateEnabled)
  // EVERY scan requires a signed-in viewer — LLM cost is easily abused, so the public funnel is gated
  // too, not just private/org scans. Viewing a SAVED report stays free: the client peeks the cache
  // (GET /api/scan?peek=1, ungated) first and only reaches this stream for a real new scan. No-op in
  // dev / when auth is bypassed. Fail fast before the quota + stream.
  // Resolve the viewer ONCE here, in request scope — next/headers cookies are NOT readable inside the
  // stream's start() callback below, so getViewer() there would return null. Used for the gate AND the
  // completion-email recipient.
  const viewer = await getViewer();
  if (authGateEnabled() && !viewer) {
    return NextResponse.json({ error: "Sign in to run a scan.", code: "auth_required" }, { status: 401 });
  }
  // Completion-email recipient (when opted in): the trusted account email, or a custom address ONLY when
  // the account has none. Resolved here so the stream closure can use it without re-reading cookies.
  const notifyTo = body.notify
    ? viewer?.email ?? (isValidEmail(body.email) ? body.email.trim() : undefined)
    : undefined;

  // Weekly SOFT gate: public scans get a free per-window allowance (shared with /api/scan via
  // consumeScanQuota). The /report flow peeks the cache first (cheap, unconsumed); reaching the stream
  // means a real scan, so consume one slot here. Private (token) scans are credit-metered and skip this.
  const quota = await consumeScanQuota(request, { orgSlug, token, mock });
  if (quota.blocked) return quota.blocked;
  const quotaRemaining = quota.quotaRemaining;
  const quotaResetAt = quota.quotaResetAt;
  const quotaScope = quota.quotaScope;
  // Refund the consumed slot from the in-stream no-delivery paths below (cached hit, degrade-to-mock,
  // failure) — the free tier meters on commit, not attempt (same policy as credit metering).
  const refundQuota = quota.refund;

  // Hoisted so the stream's cancel() (fired when the client disconnects and tears the stream down
  // mid-scan) can stop the heartbeat immediately, rather than letting it fire on a dead controller
  // until start() unwinds. The scan itself already aborts via request.signal on the same disconnect.
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = makeSseSend(controller);

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
            // The JSON route serves cache hits BEFORE its quota block; the stream consumes first
            // (the cache probe lives inside start()), so refund the slot — a cached report is
            // free everywhere. The quota headers already sent overstate usage by this one slot.
            await refundQuota();
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

        // Derive the cache-poisoning guards — shared with /api/scan via classifyScanResult.
        // degradedToMock: a transient LLM failure fell back to MockProvider but the lookup key is still
        // ::llm. lowCoverage: silent per-file fetch failures degraded coverage without failing the LLM.
        const { degradedToMock, lowCoverage } = classifyScanResult(report, mock);
        // A degrade-to-mock run cost no LLM inference and delivered the deterministic floor, not
        // the product the slot pays for — refund it, mirroring the credit rule ("a degrade-to-mock
        // run is free").
        if (degradedToMock) await refundQuota();
        // Cache + persist behind the shared guards: skip BOTH caches on a degraded/low-coverage report
        // (getScanReportByCommit's DB tier would otherwise re-serve the floor cross-instance under ::llm).
        // The stream surfaces nothing from the result, so the deduped/persistedOk return is ignored here.
        await cacheAndPersistScan(report, { degradedToMock, lowCoverage }, {
          tag: "scan/stream",
          repo: parsed ? `${parsed.owner}/${parsed.repo}` : url,
          orgSlug,
          lookup,
        });
        // Stop the keepalive at the terminal frame (co-located), not only in finally, so a 15s ping
        // can't interleave after the result on a slow close.
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        send("result", report);

        // "Email me when it's done" (opt-in). Sent AFTER the result frame so the report appears
        // immediately; it still runs inside this (Vercel) invocation before the stream closes. Only
        // when the report was actually PERSISTED — a degraded/low-coverage scan isn't saved, so its
        // permalink wouldn't resolve. Recipient is the trusted account email, or the user-supplied
        // custom address ONLY when the account has none. Best-effort: dispatchScanCompletionEmail
        // never throws and is time-bounded, so a flaky SES call can't fail or delay-close the scan.
        if (notifyTo && !degradedToMock && !lowCoverage) {
          const full = `${report.repo.owner}/${report.repo.name}`;
          const url = `${publicBaseUrl()}${reportPermalink(full, report.repo.headSha)}`;
          await dispatchScanCompletionEmail({ to: notifyTo, repoFullName: full, url, report });
        }
      } catch (err) {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        // No report was delivered — 404/typo, upstream failure, or a client abort mid-scan. Refund
        // the weekly slot in every case: the user received nothing, and a mid-scan refresh or a
        // GitHub blip must not burn one of the anonymous tier's 3 free slots.
        await refundQuota();
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
      ...SSE_HEADERS,
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
