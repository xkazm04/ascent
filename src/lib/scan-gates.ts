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
// ORDERING IS LOAD-BEARING and is owned by the CALLER, not by this module, because the two routes
// deliberately order the gates differently:
//   • /api/scan/stream: rate limit → sign-in wall → quota (consumeScanQuota) — the limiter runs first,
//     before any auth/GitHub work, since reaching the stream already means a real scan.
//   • /api/scan:        sign-in wall → rate limit → quota — its limiter sits AFTER the free cache-hit /
//     peek / salvage returns, so the cheap hydration paths stay unthrottled, and the wall is what
//     separates "viewing a saved report" from "running a new scan".
// What both share and must never change: the rate limiter runs BEFORE the quota counter, so throttled
// traffic can never burn a monthly free-scan slot.

import { recordQuotaEvent } from "@/lib/db";
import { rateLimitRequestShared, SCAN_RATE_LIMIT } from "@/lib/rate-limit";
import { authGateEnabled, type Viewer } from "@/lib/access";

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
 * Public sign-in wall: in production (Supabase configured + bypass hard-off, via authGateEnabled) a REAL
 * new scan requires a signed-in viewer; no-op in dev / when auth is bypassed. Viewing a SAVED report
 * stays free — the callers place this AFTER their free cache/peek returns.
 *
 * Takes a viewer THUNK, not a viewer, to preserve both call sites exactly: the JSON route never resolves
 * a viewer when the gate is disabled (short-circuit), while the stream route resolves one earlier in
 * request scope (cookies aren't readable inside the stream's start()) and simply hands it back.
 */
export async function scanAuthGate(
  resolveViewer: () => Promise<Viewer | null> | Viewer | null,
): Promise<ScanGatePass | ScanAuthRejection> {
  if (!authGateEnabled()) return PASS;
  if (await resolveViewer()) return PASS;
  return { ok: false, reason: "auth_required" };
}
