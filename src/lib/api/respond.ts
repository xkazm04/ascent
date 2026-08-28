// The canonical error response — and the place a server-side failure actually gets REPORTED.
//
// ── THE INVERSION THIS EXISTS TO FIX ─────────────────────────────────────────────────────────────
//
// src/instrumentation.ts exports `onRequestError`, which forwards every server error to Sentry. It
// only ever sees errors that ESCAPE the handler. So the routes with no try/catch get automatic error
// reporting, while every route that dutifully catches its failure and returns a clean
// `NextResponse.json({ error }, { status: 500 })` is invisible in production — the more defensive the
// code, the darker it is. Roughly 77 of 138 route handlers are on the dark side of that line.
//
// `respondError` closes the gap without asking anyone to stop catching: pass the `cause` you caught,
// and the failure is reported AND answered.
//
// ── WHAT GETS REPORTED ───────────────────────────────────────────────────────────────────────────
//
// Only unexpected failures: status >= 500, or any status where the caller explicitly passes a
// `cause`. A 400/401/403/404/429 is the system working correctly and must not become Sentry noise —
// that is exactly the flood that trains people to ignore the tool.
//
// Reporting is best-effort and never blocks the response: the capture is scheduled with `after()` so
// it runs once the response is on the wire, and every failure inside it is swallowed. An error
// response is more important than its telemetry.
//
// Architect ADR 2026-08-28-route-response-seam.

import { NextResponse, after } from "next/server";

/** The app's error envelope. `code` is optional and machine-readable; `error` is for humans. */
export interface ErrorBody {
  error: string;
  code?: string;
}

export interface RespondErrorOpts {
  /** Machine-readable discriminator, surfaced to clients that branch on it (e.g. the scan family). */
  code?: string;
  /** Extra response headers — e.g. `retry-after` on a throttle. */
  headers?: Record<string, string>;
  /** The underlying failure. Passing it opts this response into error reporting at ANY status. */
  cause?: unknown;
}

/** True when this response represents something nobody intended — worth a report. */
function isUnexpected(status: number, opts: RespondErrorOpts): boolean {
  return status >= 500 || opts.cause !== undefined;
}

/**
 * Report a handled failure to Sentry, mirroring instrumentation.ts's contract: a strict no-op unless
 * SENTRY_DSN is set, and a dynamic import so no route pulls the SDK in when telemetry is off.
 *
 * Exported separately from {@link respondError} because not every handled failure ends as a JSON
 * response: an SSE route (scan/stream, athena/message) has already sent its 200 and reports failure
 * as an `error` FRAME, so it needs the reporting without the response. Those are among the most
 * expensive paths in the app and were fully dark.
 *
 * Scheduled via `after()` (the same primitive the GitHub webhook uses to defer its scan work) so the
 * dynamic import cannot delay the error response. `after()` throws outside a request scope — a unit
 * test calling respondError directly — so the whole thing is wrapped: telemetry must never be able to
 * turn a 500 into a crash.
 */
export function reportHandledError(
  cause: unknown,
  context: { status?: number; message: string; code?: string },
): void {
  if (!process.env.SENTRY_DSN) return;
  try {
    after(async () => {
      try {
        const Sentry = await import("@sentry/nextjs");
        Sentry.captureException(cause, { extra: context });
      } catch {
        // Telemetry is best-effort. A Sentry outage is not this request's problem.
      }
    });
  } catch {
    // Outside a request scope (unit tests). Nothing to schedule against.
  }
}

/**
 * Build the app's canonical error response, reporting the cause when the failure is unexpected.
 *
 * Wire-identical to the hand-rolled `NextResponse.json({ error }, { status })` used across the route
 * layer, so adopting it in one route at a time is invisible to clients and a half-migrated tree is
 * not a mixed contract — only a mixed implementation.
 *
 *   return respondError(502, "GitHub is unavailable.", { code: "UPSTREAM", cause: err });
 */
export function respondError(status: number, message: string, opts: RespondErrorOpts = {}): NextResponse {
  const body: ErrorBody = opts.code ? { error: message, code: opts.code } : { error: message };
  if (isUnexpected(status, opts) && opts.cause !== undefined) {
    reportHandledError(opts.cause, { status, message, code: opts.code });
  }
  return NextResponse.json(body, opts.headers ? { status, headers: opts.headers } : { status });
}
