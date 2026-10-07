// POST /api/scan/stream  { url, mock?, installationId?, fresh?, headSha?, headEtag?, notify?, email?, ref?, subPath? }
// Server-Sent Events: emits `progress` events through the scan, then a `result` event
// with the final ScanReport (or an `error` event). Powers the live progress UI.
//
// THE SSE ADAPTER over `src/lib/scan-lifecycle.ts`. Everything from the coordinate to the persisted
// report lives there, in ONE copy shared with /api/scan; this file owns the protocol (frames, the
// heartbeat, the completion email) and its own gate PLACEMENT: all four pre-scan gates run at the top
// of the handler, because reaching this route already means a real scan and the quota/credit headers
// have to be flushed when the stream opens.

import { NextResponse } from "next/server";
import { GitHubError } from "@/lib/github/source";
import { reportHandledError } from "@/lib/api/respond";
import { resolveScanAuth } from "@/lib/scan";
import { UNSCOPED, resolveScanScope, type ResolvedScanScope } from "@/lib/scan-scope-server";
import { tooManyRequests } from "@/lib/rate-limit";
import { consumeScanQuota } from "@/lib/scan-finalize";
import { scanAuthGate, scanCreditGate, scanRateLimitGate } from "@/lib/scan-gates";
import {
  INVALID_SCAN_URL,
  createScanRefundLedger,
  isScanAbort,
  resolveScanCoordinate,
  runScanLifecycle,
} from "@/lib/scan-lifecycle";
import { scanCreditRefusal } from "@/lib/entitlement";
import { getViewer } from "@/lib/access";
import { publicBaseUrl } from "@/lib/site";
import { reportPermalink } from "@/lib/ui";
import { dispatchScanCompletionEmail, emailSendingEnabled, isValidEmail } from "@/lib/email";
import { SSE_HEADERS, makeSseSend } from "@/lib/sse-server";
import type { ScanProgress } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300s (Vercel's max on Pro): a live Gemini-Flash scan plus the in-request completion email must fit
// inside one function invocation. The client backstop (SCAN_CLIENT_TIMEOUT_MS) sits above this.
export const maxDuration = 300;

export async function POST(request: Request) {
  // silent by design: an unparseable body has no `url`, which the validation below answers with a 400
  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    mock?: boolean;
    installationId?: string;
    fresh?: boolean;
    // Head sha/etag the /report peek resolved. Accepted for backward-compat with older clients but NO
    // LONGER USED for ingestion: the head is re-resolved server-side (inside the lifecycle) so a
    // client-supplied sha can't pin/stamp/persist the scored commit. Kept in the type so clients still
    // sending them don't fail validation.
    headSha?: string;
    headEtag?: string | null;
    // "Email me when it's done" opt-in. `email` is a custom recipient used ONLY when the signed-in
    // account has no email; otherwise the trusted viewer email is used (see the send below).
    notify?: boolean;
    email?: string;
    // Optional SCOPE (G7-07 / G7-08): a git ref to score instead of the default branch, and/or a
    // monorepo sub-path to aim the ingestion budget at. Both are validated + resolved server-side
    // (resolveScanScope); a scoped result is never persisted to the shared corpus.
    ref?: string;
    subPath?: string;
  };
  if (!body.url || typeof body.url !== "string") {
    return NextResponse.json({ error: "Missing 'url' in request body." }, { status: 400 });
  }

  // Rate-limit the live scan funnel (shares the per-IP/global budget with /api/scan). The /report
  // flow peeks the cache first (cheap, unthrottled); reaching the stream means a real scan.
  // Shared with /api/scan via scanRateLimitGate (cross-instance ceiling + the rate_limit quota event);
  // rejected here, before the SSE stream opens, so it renders as a plain JSON 429. Stays BEFORE the
  // quota consume below.
  const rl = await scanRateLimitGate(request);
  if (!rl.ok) return tooManyRequests(rl.rl); // the whole result: these two are the only routes on the shared scan budget, so a global refusal must say so

  const url = body.url;
  const mock = Boolean(body.mock);
  const fresh = Boolean(body.fresh);
  // FORGE COORDINATE — shared with /api/scan via resolveScanCoordinate. This route used to call
  // `parseRepoUrl` and 400 with GitHub-only copy, so every `gitlab:group/project` the scan form emits
  // (src/components/scan/normalizeScanRepo.ts) died here while POST /api/scan scanned it — on the live
  // path the report page actually drives.
  const coordinate = resolveScanCoordinate(url);
  const { parsed, ghParsed, forgeId } = coordinate;
  // Reject a provably-invalid URL BEFORE the quota block below: scanRepository would throw INVALID_URL
  // anyway, but only after the monthly slot was consumed — a typo must not burn one of the anonymous
  // tier's free slots. Same body as the JSON route's (INVALID_SCAN_URL).
  if (!parsed) {
    return NextResponse.json(INVALID_SCAN_URL, { status: 400 });
  }
  // noAmbientToken: the owner is an installed org this caller may not mint for — never downgrade to
  // the operator PAT, which would leak the private repo the mint gate just denied. A non-GitHub
  // coordinate must NEVER reach the ambient GITHUB_TOKEN either: that would be a GitHub credential
  // sent to another forge's host.
  const resolvedAuth = await resolveScanAuth(ghParsed, body.installationId);
  const token = resolvedAuth.token;
  const orgSlug = resolvedAuth.orgSlug;
  const noAmbientToken = (resolvedAuth.noAmbientToken ?? false) || forgeId !== "github";

  // Supabase login wall. In production (Supabase configured + bypass hard-off, via authGateEnabled) a
  // PRIVATE / installed-org scan requires a signed-in viewer. The anonymous PUBLIC funnel is exempt by
  // default (UAT TOMAS-L1-01 — the advertised free no-signup scan was answering 401; rationale and the
  // ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN opt-in live in scan-gates.ts). LLM cost on that funnel is
  // ceilinged by the burst limiter above and the monthly free-scan quota below, not by this wall.
  // Viewing a SAVED report stays free: the client peeks the cache
  // (GET /api/scan?peek=1, ungated) first and only reaches this stream for a real new scan. No-op in
  // dev / when auth is bypassed. Fail fast before the quota + stream.
  // Resolve the viewer ONCE here, in request scope — next/headers cookies are NOT readable inside the
  // stream's start() callback below, so getViewer() there would return null. Used for the gate AND the
  // completion-email recipient.
  const viewer = await getViewer();
  // Shared with /api/scan via scanAuthGate; the viewer is handed to it already resolved (it takes a
  // thunk so the JSON route can keep its lazy resolve). Rejected before the stream opens → JSON 401.
  const authGate = await scanAuthGate(() => viewer, { publicScan: orgSlug === "public" && !token });
  if (!authGate.ok) {
    return NextResponse.json({ error: "Sign in to run a scan.", code: "auth_required" }, { status: 401 });
  }

  // SCOPE (G7-07 / G7-08). Placed AFTER the sign-in wall (so an anonymous caller can't drive the
  // GitHub ref-resolve behind a PRIVATE/org scan's installation token) and BEFORE the quota consume
  // below (so a typo'd branch name 400/404s without burning a free slot). Resolved HERE, not inside
  // the lifecycle, because its refusal must be a plain JSON status before the stream opens — the one
  // reason it is not a lifecycle stage. A non-GitHub coordinate has no ref resolver, so it is UNSCOPED
  // (the same honest degrade a token-less GitHub scan takes).
  const scopeToken = token ?? (noAmbientToken ? undefined : process.env.GITHUB_TOKEN);
  const scoping: ResolvedScanScope = ghParsed
    ? await resolveScanScope(ghParsed, { ref: body.ref, subPath: body.subPath }, { token: scopeToken })
    : UNSCOPED;
  if (scoping.error) {
    return NextResponse.json({ error: scoping.error.message, code: scoping.error.code }, { status: scoping.error.status });
  }
  // Completion-email recipient (when opted in). For a SIGNED-IN viewer we ONLY ever send to their own
  // verified account address — never a client-supplied `email`. The old `viewer?.email ?? body.email`
  // fallback let an authenticated viewer with no account email have Ascent's verified SES domain mail an
  // ARBITRARY recipient (an open-relay / branded-spam vector). The custom `email` opt-in is honored ONLY
  // on the anonymous public funnel (no viewer, where there's no account address), and that funnel is
  // already rate-limited per-IP/global; a fuller anti-abuse step (double opt-in confirmation for an
  // anonymous recipient) is tracked as a follow-up. Resolved here so the stream closure can use it.
  const notifyTo = !body.notify
    ? undefined
    : viewer
      ? (isValidEmail(viewer.email) ? viewer.email : undefined)
      : (isValidEmail(body.email) ? body.email.trim() : undefined);

  // Monthly SOFT gate (rolling 30-day window, default 5 — src/lib/public-scan-quota.ts is the single
  // source of truth for the window and allowance): public scans get a free per-window allowance
  // (shared with /api/scan via consumeScanQuota). The /report flow peeks the cache first (cheap,
  // unconsumed); reaching the stream means a real scan, so consume one slot here. Private (token) scans
  // skip the monthly quota because they are credit-metered by the gate immediately below.
  const quota = await consumeScanQuota(request, { orgSlug, token, mock });
  if (quota.blocked) return quota.blocked;
  const { quotaRemaining, quotaResetAt, quotaScope } = quota;

  // Credit RESERVATION for a metered (private / installed-org) scan — the fourth and last pre-scan
  // gate, shared with /api/scan via scanCreditGate and sequenced there identically (rate limit →
  // sign-in wall → quota → credit). Reserved HERE, before the stream opens and before any inference,
  // so a 402/404 is a plain JSON response rather than an SSE `error` frame, and so two concurrent scans
  // cannot both pass a point-in-time balance read and both run paid inference. Public (token-less)
  // and mock scans are never charged — `isMeteredScan` inside the gate short-circuits them.
  const credit = await scanCreditGate(orgSlug, {
    mock,
    repoFullName: coordinate.repoIdentity,
    // The viewer was already resolved in request scope above (cookies aren't readable inside start()),
    // so the thunk just hands it back — the ledger row names the person whose scan spent the credit.
    resolveActor: () => viewer?.login ?? null,
  });
  if (!credit.ok) return scanCreditRefusal(credit);

  // The ONE refund ledger (src/lib/scan-lifecycle.ts) — which meter is handed back in each
  // no-delivery situation, named once instead of six hand-placed awaits per route. Both meters bill on
  // commit, not attempt; both refunds are idempotent.
  const ledger = createScanRefundLedger({ refundQuota: quota.refund, refundCredit: credit.hold.refund });

  // Hoisted so the stream's cancel() (fired when the client disconnects and tears the stream down
  // mid-scan) can stop the heartbeat immediately, rather than letting it fire on a dead controller
  // until start() unwinds. The scan itself already aborts via request.signal on the same disconnect.
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = makeSseSend(controller);
      const stopHeartbeat = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
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
        await runScanLifecycle(
          {
            url,
            coordinate,
            orgSlug,
            token,
            noAmbientToken,
            scoping,
            mock,
            fresh,
            // Abort the scan (GitHub ingest + LLM) when the browser navigates away or aborts the SSE
            // stream, instead of running it to completion for a closed connection.
            signal: request.signal,
            // Individual tier (decision 5): a signed-in viewer's public-funnel scan reads THEIR
            // personal-org standing decisions into the prompt (viewer was resolved in request scope
            // above — cookies aren't readable in start()). Org-persisted scans keep org scoping.
            resolveDecisionOrgSlug: () =>
              orgSlug === "public" && viewer ? viewer.login.trim().toLowerCase() : undefined,
            ledger,
          },
          {
            tag: "scan/stream",
            // Progress sink for THIS connection. When the scan is coalesced, coalesceScan fans the
            // owner's frames out to every joined caller through this (and replays the latest frame on
            // join), so a second viewer of the same uncached commit sees live progress instead of a
            // stalled-looking bar.
            onProgress: (p: ScanProgress) => send("progress", p),
            // Tell the joiner immediately that it attached to a run already under way — the replayed
            // last frame may still be a stage or two behind, and an unexplained pause at 0% reads as a
            // broken scan.
            //
            // TWO frames on purpose. `joined` is the CONTRACT: a dedicated event the client branches on
            // to render its restored-work line, so this copy can be rewritten without silently switching
            // that UI off (a message-string match is not a contract). The `progress` frame stays because
            // it is what moves the bar off 0% for a client that does not know the event. Reaching here
            // from a RELOAD is what coalesceScan's linger window made possible (src/lib/cache.ts); before
            // it, only a second concurrent tab could ever get these frames.
            onJoin: () => {
              send("joined", { message: "Rejoined a scan already in progress" });
              send("progress", { stage: "fetch", message: "Joining a scan already in progress…", pct: 5 });
            },
            deliverCached: (report, source) => {
              send("progress", {
                stage: "done",
                message: source === "db" ? "Loaded from a saved scan" : "Loaded from cache",
                pct: 100,
              });
              send("result", report);
            },
            deliverResult: async (report, outcome) => {
              // Stop the keepalive at the terminal frame (co-located), not only in finally, so a 15s
              // ping can't interleave after the result on a slow close.
              stopHeartbeat();
              // Notify PRE-FLIGHT frame, emitted BEFORE `result` on purpose: the client settles on the
              // `result` frame and stops reading, so anything sent after it never reaches the user. The
              // status is derived from the SAME sender selection the dispatch below uses
              // (emailSendingEnabled), so "unconfigured" is authoritative.
              //
              // `outcome.willPersist` is the SHARED authority fact (scan-lifecycle), not a hand-kept
              // copy of cacheAndPersistScan's guard: the mail links a permalink that only resolves once
              // the report is persisted, so a poisoning vector added to classifyScanResult suppresses
              // the mail here with no edit in this file.
              if (notifyTo && outcome.willPersist) {
                send("notify", {
                  to: notifyTo,
                  status: emailSendingEnabled() ? "sending" : "unconfigured",
                  ...(emailSendingEnabled()
                    ? {}
                    : { message: "Email isn't configured on this deployment, so we can't send the report link." }),
                });
              }
              // BEFORE `result`: the client settles on that frame and stops reading. `ok` is the same
              // durable-store fact cacheAndPersistScan just computed — the live-scan page rewrites
              // `/report?repo=` to `/report/{owner}/{repo}` only when this is true, so a reload cannot
              // land on ColdScanGate under a URL whose metadata would claim a scored report.
              send("persisted", { ok: outcome.durable });
              send("result", report);

              // "Email me when it's done" (opt-in). Sent AFTER the result frame so the report appears
              // immediately; it still runs inside this (Vercel) invocation before the stream closes.
              // Best-effort: dispatchScanCompletionEmail never throws and is time-bounded, so a flaky
              // SES call can't fail or delay-close the scan. The outcome is CONSUMED (not discarded):
              // `skipped` means no provider is wired and nothing was sent.
              if (notifyTo && outcome.willPersist) {
                const full = `${report.repo.owner}/${report.repo.name}`;
                const link = `${publicBaseUrl()}${reportPermalink(full, report.repo.headSha)}`;
                const mail = await dispatchScanCompletionEmail({ to: notifyTo, repoFullName: full, url: link, report });
                if (mail.skipped) {
                  console.warn("[scan/stream] notify opted in but no email provider is configured — nothing sent", { repo: full });
                } else if (!mail.ok) {
                  console.error("[scan/stream] completion email failed to send", { repo: full });
                }
              }
            },
            deliverFailure: (err, salvaged) => {
              stopHeartbeat();
              // ERROR SALVAGE, shared with /api/scan: a transient upstream/LLM failure on a repo we
              // have scored before serves the most recent persisted report rather than a dead end. The
              // `stale` frame is what marks it as not head-fresh, mirroring the JSON route's
              // x-ascent-stale + x-ascent-fallback=error headers; the report UI's "Re-test" still
              // forces a re-score. Never on a client abort and never on a scoped scan (the lifecycle
              // decides both, so the two entry points cannot disagree).
              if (salvaged) {
                send("stale", { fallback: "error" });
                send("result", salvaged);
                return;
              }
              // A deliberate abort (client disconnect / scan timeout) is not a scan error to report —
              // the consumer is already gone and the scan stopped as intended. Don't emit a misleading
              // "Unexpected error" frame (the JSON route maps the same AbortError to a 499).
              if (isScanAbort(err) || request.signal.aborted) return;
              const payload =
                err instanceof GitHubError
                  ? { error: err.message, code: err.code }
                  : { error: "Unexpected error while scanning the repository." };
              // A GitHubError is a known upstream outcome; anything else is a defect. Report the latter:
              // the 200 and headers went out long ago, so this failure can never reach onRequestError,
              // and the app's most expensive path was failing invisibly in production. No status — an
              // SSE failure has no status left to carry.
              if (!(err instanceof GitHubError)) {
                reportHandledError(err, { message: "scan/stream failed after the stream opened" });
              }
              send("error", payload);
            },
          },
        );
      } catch (err) {
        stopHeartbeat();
        // Nothing was delivered by a stage AFTER the scan (a persist/alert blow-up). Refund both
        // meters: the user received nothing, and the lifecycle's own refunds are idempotent, so this
        // can neither double-mint nor miss.
        await ledger.onFailure();
        if (!isScanAbort(err) && !request.signal.aborted) {
          const payload =
            err instanceof GitHubError
              ? { error: err.message, code: err.code }
              : { error: "Unexpected error while scanning the repository." };
          if (!(err instanceof GitHubError)) {
            reportHandledError(err, { message: "scan/stream failed after the stream opened" });
          }
          send("error", payload);
        }
      } finally {
        stopHeartbeat();
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
      // Free public scans left in this bucket's rolling 30-day window (after this scan), plus when the
      // window resets; only set when the monthly gate enforced (public funnel). Lets the client
      // warn before the gate trips.
      ...(quotaRemaining !== null ? { "x-ascent-quota-remaining": String(quotaRemaining) } : {}),
      ...(quotaResetAt !== null ? { "x-ascent-quota-reset": String(quotaResetAt) } : {}),
      ...(quotaScope !== null ? { "x-ascent-quota-scope": quotaScope } : {}),
      // The org's prepaid balance after this metered scan's RESERVATION, mirroring /api/scan. Headers
      // are flushed when the stream opens, which is before start() can refund, so — unlike the JSON
      // route's — this figure is pre-refund: a scan that degrades, dedups or fails hands the credit
      // back and the real balance is one higher than the number sent here. Same soft-header caveat the
      // quota fields above already carry.
      ...(credit.hold.remaining !== null ? { "x-ascent-credits-remaining": String(credit.hold.remaining) } : {}),
    },
  });
}
