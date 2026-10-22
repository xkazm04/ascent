// A per-minute limiter refusal, read off the 429 the scan stream route sends before the SSE opens
// (src/lib/rate-limit.ts `tooManyRequests`: code, scope, limiter, limit, windowSec, retryAfterSec plus
// a `retry-after` header). Pure: no React, no clock of its own (every reader takes `nowMs`).
//
// WHY A MODE AND NOT AN ERROR. The limiter's retry-after is the honest drain time of the oldest
// in-window hit, so a caller that waits it out is admitted. The report page used to render the refusal
// as a generic "Couldn't scan that repo" with a "Try again" that re-tripped the same window. Here it
// becomes a wait: count down, then resume, bounded so a stuck budget never becomes a retry loop.
//
// WHAT IS NOT A THROTTLE: the monthly free-scan quota (429 `monthly_quota`, its own salvage + wall),
// the credit gate (402) and the sign-in wall (401). parseThrottle returns null for all three, so their
// paths in useReportScan stay exactly as they were.
//
// THE BOUNDS (throttleStep):
//   - at most MAX_AUTO_RESUMES automatic resumes per report visit, then the visitor resumes by hand;
//   - never from a hidden tab (a background tab spending scans nobody is watching);
//   - a jitter in [0, JITTER_MAX_MS) on top of retry-after, so a herd refused together does not come
//     back together (the refusal contract leaves de-correlation to the consuming side).
// An automatic resume costs no monthly slot: the limiter runs before the quota consume (scan-gates.ts).

export type ThrottleScope = "ip" | "global" | "unavailable" | "unknown";

export type Throttle = {
  /** Whose budget refused: the visitor's own (`ip`), the shared one (`global`), the limiter could not
   *  run (`unavailable`), or an older body that did not say (`unknown`). */
  scope: ThrottleScope;
  /** Epoch ms when the window has drained enough to admit this caller again. */
  retryAt: number;
  limiter?: string;
  /** The visitor's own cap, stated only on an `ip` refusal (the global ceiling is withheld on purpose). */
  limit?: number;
  windowSec?: number;
};

export const MAX_AUTO_RESUMES = 2;
export const JITTER_MAX_MS = 2000;
/** No retry hint at all (no body field, no header): wait a full minute window rather than guess short. */
export const FALLBACK_RETRY_SEC = 60;

const THROTTLE_CODES = new Set(["rate_limited", "rate_limit_unavailable"]);

function finiteNonNeg(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** `retry-after` in its delta-seconds form; an HTTP-date or junk reads as absent. */
function headerSeconds(raw: string | null): number | null {
  if (raw == null || !/^\s*\d+(\.\d+)?\s*$/.test(raw)) return null;
  return Number(raw);
}

function readScope(body: Record<string, unknown> | null): ThrottleScope {
  if (body?.code === "rate_limit_unavailable" || body?.scope === "unavailable") return "unavailable";
  if (body?.scope === "ip" || body?.scope === "global") return body.scope;
  return "unknown";
}

/**
 * The refusal as a Throttle, or null when it is not a per-minute limiter refusal. `body` is the parsed
 * JSON (null when unreadable), `retryAfterHeader` the raw `retry-after` header.
 */
export function parseThrottle(
  status: number,
  body: unknown,
  retryAfterHeader: string | null,
  nowMs: number = Date.now(),
): Throttle | null {
  if (status !== 429) return null;
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  // A body that names a code names it for a reason: only the limiter's two codes are a throttle.
  if (b && typeof b.code === "string" && !THROTTLE_CODES.has(b.code)) return null;
  const sec = finiteNonNeg(b?.retryAfterSec) ?? headerSeconds(retryAfterHeader) ?? FALLBACK_RETRY_SEC;
  const t: Throttle = { scope: readScope(b), retryAt: nowMs + Math.round(sec * 1000) };
  if (typeof b?.limiter === "string") t.limiter = b.limiter;
  const limit = finiteNonNeg(b?.limit);
  const windowSec = finiteNonNeg(b?.windowSec);
  if (limit != null) t.limit = limit;
  if (windowSec != null) t.windowSec = windowSec;
  return t;
}

export type ThrottleStep =
  | { kind: "wait"; ms: number }
  | { kind: "resume" }
  | { kind: "paused" }
  | { kind: "manual" };

/** What the timer does next. `rng` is injected so the jitter is testable. */
export function throttleStep(
  t: Throttle,
  nowMs: number,
  autoUsed: number,
  visible: boolean,
  rng: () => number = Math.random,
): ThrottleStep {
  if (autoUsed >= MAX_AUTO_RESUMES) return { kind: "manual" };
  if (!visible) return { kind: "paused" };
  if (nowMs >= t.retryAt) return { kind: "resume" };
  const jitter = Math.floor(Math.min(Math.max(rng(), 0), 0.999999) * JITTER_MAX_MS);
  return { kind: "wait", ms: t.retryAt - nowMs + jitter };
}

/** Whole seconds left on the countdown, never negative. */
export function secondsLeft(t: Throttle, nowMs: number = Date.now()): number {
  return Math.max(0, Math.ceil((t.retryAt - nowMs) / 1000));
}

/** The one-line generic message carried on the error state (the notice renders the per-scope copy). */
export const THROTTLED_MESSAGE = "Scanning is paused for a moment by the rate limit.";

/** Per-scope headline + explanation. No em dashes: house copy rule. */
export function throttleCopy(t: Throttle): { title: string; body: string } {
  switch (t.scope) {
    case "ip": {
      const pace =
        t.limit != null && t.windowSec != null
          ? ` (${t.limit} scan${t.limit === 1 ? "" : "s"} per ${t.windowSec}s)`
          : "";
      return {
        title: "You are scanning faster than the free pace",
        body: `This is your own pace limit${pace}. Nothing was charged, and the scan picks up once the window clears.`,
      };
    }
    case "global":
      return {
        title: "The shared scan budget is busy",
        body: "Many scans are running right now. This is not your traffic: it clears as other scans finish, and nothing was charged to you.",
      };
    case "unavailable":
      return {
        title: "The rate limiter is briefly unreachable",
        body: "No budget of yours was exceeded and nothing was counted. The scan retries once the limiter answers again.",
      };
    default:
      return {
        title: "Scans are briefly rate limited",
        body: "The scan picks up on its own once the limit window clears.",
      };
  }
}
