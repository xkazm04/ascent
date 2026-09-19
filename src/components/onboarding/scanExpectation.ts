// How long the wizard's scan step should tell the user to expect (Direction 9).
//
// The wizard never stated a duration: it said "Scanning N repositories…" and "x% · c/N", while a live
// run can take MINUTES per repo (importScan.ts sizes STALL_MS at 360_000 for exactly that reason).
// That silence is the seam that makes people refresh — and refreshing was, until the re-attach landed,
// how runs got duplicated.
//
// The numbers are NOT re-derived here. `src/components/report/scanEstimate.ts` is the single source of
// scan calibration: it already feeds the report's progress curve, its expectation copy, the client
// backstop AND the landing page's promise, so the bar and the marketing sentence cannot disagree. The
// wizard reads the same constants; a second number would be a second thing to keep true.
//
// The other half is CONCURRENCY: the import route scans with `mapPool(fullNames, SCAN_CONCURRENCY, …)`
// (src/app/api/org/import/route.ts), so eight repos are not eight serial scans — they are two waves of
// four. Assuming serial would over-state a ten-repo run by 2.5×.

import { SCAN_CONCURRENCY } from "@/lib/pool";
import {
  CLAUDE_CLI_ESTIMATE_MS,
  HOSTED_ESTIMATE_MS,
  MOCK_ESTIMATE_MS,
  approxScanDuration,
} from "@/components/report/scanEstimate";

/**
 * What the CLIENT can know about the run's engine at the moment the scan step renders.
 *
 * - `mock` — a deterministic preview: no model call at all.
 * - `hosted` / `claude-cli` — a live run whose provider IS known (nothing passes these today; the
 *   wizard's import stream carries no resolved provider, unlike the report's SSE frames).
 * - `unknown` — a live run with no resolved provider. The report's backstop rule applies: assume the
 *   SLOWEST provider so a later resolution can only SHORTEN the estimate, and say "up to" rather than
 *   printing a p50 as if it were a promise.
 */
export type ScanExpectationMode = "mock" | "hosted" | "claude-cli" | "unknown";

/** Per-repo wall-clock for one scan, straight off the report's calibration constants. */
export function perRepoEstimateMs(mode: ScanExpectationMode): number {
  switch (mode) {
    case "mock":
      return MOCK_ESTIMATE_MS;
    case "hosted":
      return HOSTED_ESTIMATE_MS;
    case "claude-cli":
      return CLAUDE_CLI_ESTIMATE_MS;
    default:
      // Slowest ceiling first — the same rule scanEstimateMs() uses for an unresolved provider.
      return CLAUDE_CLI_ESTIMATE_MS;
  }
}

/**
 * Wall-clock for a whole import batch: `ceil(repos / concurrency)` waves of one per-repo scan. A wave
 * is only as fast as its slowest member, so the ceiling (not the average) is the honest unit — five
 * repos at concurrency 4 is two waves, the same as eight.
 */
export function scanExpectationMs(
  repoCount: number,
  mode: ScanExpectationMode,
  concurrency: number = SCAN_CONCURRENCY,
): number {
  if (repoCount <= 0) return 0;
  const lanes = Math.max(1, Math.floor(concurrency) || 1);
  const waves = Math.ceil(repoCount / lanes);
  return waves * perRepoEstimateMs(mode);
}

/**
 * The one sentence the scan step prints. Rounded by `approxScanDuration` — deliberately coarse and
 * rounding AWAY from the flattering number, because the constants are a measured p50, not a promise.
 * Returns null when there is nothing to promise (no repos), so the caller renders nothing.
 */
export function scanExpectationCopy(
  repoCount: number,
  mode: ScanExpectationMode,
  concurrency: number = SCAN_CONCURRENCY,
): string | null {
  if (repoCount <= 0) return null;
  const lanes = Math.max(1, Math.floor(concurrency) || 1);
  const duration = approxScanDuration(scanExpectationMs(repoCount, mode, lanes));
  const noun = repoCount === 1 ? "repository" : "repositories";
  // "Usually" for a mode we can name; "Up to" when the estimate is the slowest-provider ceiling, so the
  // sentence is never a p50 dressed as a guarantee.
  const lead = mode === "unknown" ? "Up to" : "Usually";
  const pool = repoCount > lanes ? `, ${lanes} at a time` : "";
  return `${lead} ${duration} for ${repoCount} ${noun}${pool}.`;
}
