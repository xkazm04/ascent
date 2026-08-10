// Shared PRE-scan gates for the two single-repo scan entry points — /api/scan (sync JSON) and
// /api/scan/stream (SSE). Both routes ran byte-identical copies of the burst rate limiter (with its
// quota-event observability side effect) and the public sign-in wall; a fix to one silently missed the
// other.
//
// These helpers return a DECISION, never a Response: each route surfaces a rejection in its own
// protocol (today both reject before the SSE stream opens, so both render JSON — but the stream route
// must stay free to emit an `error` frame instead if a gate ever moves inside start(), and a shared
// response builder would flatten that distinction).
//
// ORDERING IS LOAD-BEARING. Both routes now run the SAME sequence (G8-49):
//
//     rate limit → sign-in wall → quota (consumeScanQuota)
//
// The routes differ only in WHERE that sequence sits, which is a placement question, not an ordering
// one:
//   • /api/scan/stream: at the top of the handler — reaching the stream already means a real scan.
//   • /api/scan:        after the free cache-hit / peek / salvage returns, so the cheap hydration
//     paths stay unthrottled and a saved report still costs nothing.
//
// WHY THIS ORDER, and why it was unified. The two routes used to disagree (the stream limited first,
// the JSON route walled first), so one throttled anonymous request got 401 from one endpoint and 429
// from the other, and only the stream recorded the `rate_limit` quota event — throttled JSON traffic
// was invisible to observability. Rate limit wins the tie because:
//   1. It is the TRUTHFUL answer. "The shared scan budget is exhausted" holds no matter who is asking;
//      signing in does not lift a burst limit, so a 401 sends the caller into a flow that cannot help.
//   2. It is the CHEAPER answer — an in-memory/shared-store counter versus a Supabase session resolve.
//   3. It is the SAFER answer. The limiter is the cost ceiling; deciding it only for callers who first
//      pass an auth check makes the ceiling conditional on an unrelated gate.
//   4. It leaks nothing. Both rejections are anonymous-visible and neither reveals repo existence.
// The one deliberate exception is documented at its call site: /api/scan's PRIVATE-scan wall
// (orgSlug !== "public") still precedes the limiter, because moving it below would let an anonymous
// caller drive a GitHub ref resolve against a private repo.
//
// What both share and must never change: the rate limiter runs BEFORE the quota counter, so throttled
// traffic can never burn a monthly free-scan slot.

import { recordQuotaEvent } from "@/lib/db";
import { rateLimitRequestShared, SCAN_RATE_LIMIT } from "@/lib/rate-limit";
import { authGateEnabled, type Viewer } from "@/lib/access";
import { publicScanSignInRequired } from "@/lib/env";

/**
 * Outcome of one pre-scan gate. `ok: true` means "proceed"; a rejection carries only what the caller
 * needs to render it in its own protocol (JSON body / SSE frame), never a built Response.
 */
export type ScanGatePass = { ok: true };
/** Over the per-IP / fleet-wide burst budget. `retryAfterSec` feeds the caller's Retry-After. */
export type ScanRateLimitRejection = { ok: false; reason: "rate_limited"; retryAfterSec: number };
/** The sign-in wall is on and no viewer is signed in. */
export type ScanAuthRejection = { ok: false; reason: "auth_required" };
export type ScanGateDecision = ScanGatePass | ScanRateLimitRejection | ScanAuthRejection;

const PASS: ScanGatePass = { ok: true };

/**
 * Burst/global rate limit for the EXPENSIVE scan path (shared per-IP + fleet-wide budget across both
 * routes). Records the `rate_limit` quota event on rejection — the observability side effect both
 * routes carried inline. Callers render `retryAfterSec` themselves (JSON routes: `tooManyRequests`).
 * MUST be sequenced before the quota consume so throttled traffic never burns a free slot.
 */
export async function scanRateLimitGate(req: Request): Promise<ScanGatePass | ScanRateLimitRejection> {
  const rl = await rateLimitRequestShared(req, SCAN_RATE_LIMIT);
  if (rl.ok) return PASS;
  void recordQuotaEvent("rate_limit", "scan").catch(() => {}); // QUOTA #2: observability on the costly scan path
  return { ok: false, reason: "rate_limited", retryAfterSec: rl.retryAfterSec };
}

/**
 * Sign-in wall for a REAL new scan: in production (Supabase configured + bypass hard-off, via
 * authGateEnabled) a scan requires a signed-in viewer; no-op in dev / when auth is bypassed. Viewing a
 * SAVED report stays free — the callers place this AFTER their free cache/peek returns.
 *
 * UAT TOMAS-L1-01 — THE ANONYMOUS PUBLIC FUNNEL IS EXEMPT BY DEFAULT. This gate used to wall every
 * scan, public included, which made `POST /api/scan` on a public repo 401 in production while every
 * read-only surface stayed open: the product left open every surface that would not convince a buyer
 * and walled the single one that would, under a page promising "no signup". `publicScanSignInRequired()`
 * (`ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN`, default off) lets an operator re-wall it deliberately.
 * The cost ceiling for the anonymous funnel is unchanged and does not depend on this flag: the shared
 * burst limiter runs before this gate and the rolling monthly free-scan quota runs after it.
 *
 * `publicScan` is the caller's resolved `orgSlug === PUBLIC_ORG` — i.e. no installation token was
 * minted, so this cannot reach a private repo. A private / installed-org scan (`publicScan: false`) is
 * walled exactly as before.
 *
 * Takes a viewer THUNK, not a viewer, to preserve both call sites exactly: the JSON route never resolves
 * a viewer when the gate is disabled (short-circuit), while the stream route resolves one earlier in
 * request scope (cookies aren't readable inside the stream's start()) and simply hands it back.
 */
export async function scanAuthGate(
  resolveViewer: () => Promise<Viewer | null> | Viewer | null,
  opts: { publicScan: boolean },
): Promise<ScanGatePass | ScanAuthRejection> {
  if (!authGateEnabled()) return PASS;
  if (opts.publicScan && !publicScanSignInRequired()) return PASS;
  if (await resolveViewer()) return PASS;
  return { ok: false, reason: "auth_required" };
}
