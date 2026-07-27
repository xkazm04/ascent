// The runaway-abort backstop's re-pin rule, kept pure so it can be tested without an SSE stream.
//
// useReportScan arms a client-side abort timer at scan start. The provider is unknown then, so it
// starts at the SLOWEST provider's ceiling (scanClientTimeoutMs(undefined)) and tightens once the first
// progress frame names the resolved provider — a hosted scan then gives up on a genuine hang in ~200s
// instead of waiting out the ~12-min claude-cli ceiling.
//
// The bug this module fixes: that tighten happened ONCE and could never be revised. But scan.ts runs a
// FAILOVER plan — a step that fails hands off to a different provider and emits a progress frame
// carrying the NEW provider name. On a deploy with a hosted primary and a claude-cli fallback, the
// backstop was already pinned to the hosted ~200s ceiling when the scan switched to claude-cli, whose
// real work takes minutes — so the client aborted a scan that was legitimately still running, and the
// user saw "The scan timed out" on a scan the server went on to finish.
//
// The rule, therefore, is asymmetric on purpose:
//   • the FIRST resolution (unknown → a named provider) may shorten the window, which is the whole
//     point of pinning;
//   • every later provider change may only LENGTHEN it. Never shorten mid-flight — a scan that has
//     already been running under a long ceiling must not be retroactively judged by a shorter one
//     (the reverse claude-cli → hosted transition, e.g. a mock/hosted fallback after a CLI failure,
//     keeps the longer ceiling and simply resolves normally via its `result` frame).
//
// The ceiling comes from the same scanClientTimeoutMs the loading UI's estimate/expectation copy is
// derived from (scanEstimate.ts, keyed off the same sticky progress.provider), so the backstop and the
// on-screen "this usually takes…" copy always describe the same provider.

import type { ProviderName } from "@/lib/types";
import { scanClientTimeoutMs } from "@/components/report/scanEstimate";

/**
 * Decide the backstop ceiling to arm for a newly-observed provider.
 *
 * @param pinnedCeilingMs the ceiling currently pinned, or `null` while the scan still runs under the
 *   unresolved (slowest-provider) default.
 * @param provider the provider named by the progress frame just received.
 * @returns the ceiling (ms from scan START) to re-arm the timer with, or `null` to leave the running
 *   timer untouched — the same provider seen again, or a failover to a FASTER one.
 */
export function nextBackstopCeilingMs(pinnedCeilingMs: number | null, provider: ProviderName): number | null {
  const ceiling = scanClientTimeoutMs(provider);
  if (pinnedCeilingMs === null) return ceiling; // first resolution: tighten off the unknown default
  return ceiling > pinnedCeilingMs ? ceiling : null; // afterwards: lengthen only
}

/** Remaining wall-clock for a ceiling measured from scan start (never negative — a ceiling already
 *  exceeded fires immediately rather than scheduling into the past). */
export function backstopRemainingMs(ceilingMs: number, elapsedMs: number): number {
  return Math.max(0, ceilingMs - elapsedMs);
}
