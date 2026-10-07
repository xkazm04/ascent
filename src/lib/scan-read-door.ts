// The doors a failed read reaches across the scan / report span, so no catch there has to choose
// between keeping its fallback and telling someone (registry: error-handling/error-doors — every
// failure reaches at least one door; silent to the user must never decay into silent to everyone).
//
//   reportFailedRead   — the failure is a FACT the caller now shows: the permalink's PermalinkReadError,
//                        a "couldn't load" notice, or a prop left unresolved so the client fetch and
//                        its own error door take over. Logged as an error.
//   reportDegradedRead — a best-effort enrichment that degrades to an unknown / empty value BY DESIGN
//                        (no gallery, a cache miss, a conservative severity). The degraded value stays;
//                        this only adds the door. Logged as a warning.
//   degradeTo          — the `.catch(...)` form of the second, so the routed path is as cheap to write
//                        as the swallow it replaces: `.catch(degradeTo("landing: gallery", null))`.
//
// Both also report to telemetry. Server-only: reportHandledError schedules on the request through
// next/server's `after`. Client components log with console.warn at the site instead.

import { reportHandledError } from "@/lib/api/respond";

/** A read whose failure the caller surfaces (or hands to a client fetch) — not a degrade. */
export function reportFailedRead(read: string, err: unknown): void {
  console.error(`[read failed] ${read}:`, err);
  reportHandledError(err, { message: `${read} failed` });
}

/** A best-effort read that degrades to an unknown / empty value by design. */
export function reportDegradedRead(read: string, err: unknown): void {
  console.warn(`[read degraded] ${read}:`, err);
  reportHandledError(err, { message: `${read} failed (degraded)` });
}

/** A rejection handler that reports the degraded read and resolves the fallback. */
export function degradeTo<T>(read: string, fallback: T): (err: unknown) => T {
  return (err) => {
    reportDegradedRead(read, err);
    return fallback;
  };
}
