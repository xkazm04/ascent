// THE KIOSK WALL'S RUN SUMMARY (backlog develop-2026-09-17 row 43). The shared war-room link
// (/live/shared/[token]) renders the standing wall; when the org has loop runs, a read-only strip
// beneath it states what the loop has done, as COUNTS: runs, verified closes, points in review.
//
// COUNTS ONLY, BY TYPE (operator decision 2026-09-24). The token page is readable by anyone who holds the
// link, on an unauthenticated TV. The in-app outcome sheet names repos, branches, commits, follow-ups and
// logins; none of that may cross to the kiosk. So the summary's TYPE is built through `CountsOnly`, which
// refuses any field that is not a number (or null for "not measured"): adding a repo name to it is a
// compile error, not a review comment. The page passes this object, and only this object, to the strip.
//
// THE THREE NUMBERS, each the same quantity the signed-in surfaces already print under the same name:
//   • runs            the org's latest runs, bounded to KIOSK_RUN_WINDOW (the cockpit lists the same 20);
//   • verifiedCloses  the sum of those runs' adjudicated closes (`LoopRunChronicleEntry.verifiedCloses`,
//                     the rescan's closedIds, never an agent's claim);
//   • pointsInReview  the Impact Ledger's `inReviewPoints`: verified points on lane branches that have not
//                     merged. NULL, never 0, when no lane is measured, exactly as the Executive tab says it.
//
// Server-only (it reads the db). Token verification is NOT done here: the page calls `resolveLiveShare`
// first and hands this the verified org, so a summary is never read for a link the page refused.

import { listLoopRuns } from "@/lib/db/loop-runs";
import { getOrgImpactLedger } from "@/lib/db/org-impact";

/** A shape whose every field is a count (or null = not measured). Anything else is a type error. */
export type CountsOnly<T extends { [K in keyof T]: number | null }> = T;

// Seen refusing a name in `live-share-summary.typecheck.ts` (a tsc-checked file; tests are not).

export type KioskRunSummary = CountsOnly<{
  /** Runs counted: the org's latest, at most `runWindow`. */
  runs: number;
  /** The bound on `runs`, so the strip can say "latest 20" rather than imply all time. */
  runWindow: number;
  /** Follow-ups those runs closed, as adjudicated by the rescan. */
  verifiedCloses: number;
  /** Verified points on unmerged lane branches. Null = no lane measured, which is not 0. */
  pointsInReview: number | null;
}>;

/** The same bound the cockpit's run list reads (`listLoopRuns(slug, 20)` in LiveTab). */
export const KIOSK_RUN_WINDOW = 20;

/**
 * Pure: fold the runs and the ledger's in-review figure into counts. Null when there are no runs, so the
 * page renders no strip rather than a row of zeros. Reads only `verifiedCloses` and `inReviewPoints`; the
 * rest of either input (repos, errors, rows) is never touched, and the return type could not carry it.
 */
export function countKioskRuns(
  runs: readonly { verifiedCloses: number }[],
  ledger: { inReviewPoints: number | null } | null,
  runWindow: number = KIOSK_RUN_WINDOW,
): KioskRunSummary | null {
  if (runs.length === 0) return null;
  return {
    runs: runs.length,
    runWindow,
    verifiedCloses: runs.reduce((n, r) => n + r.verifiedCloses, 0),
    pointsInReview: ledger?.inReviewPoints ?? null,
  };
}

/** The verified org's summary, or null when it has no runs. A failed read degrades, it never throws. */
export async function loadKioskRunSummary(org: string): Promise<KioskRunSummary | null> {
  const runs = await listLoopRuns(org, KIOSK_RUN_WINDOW).catch(() => []);
  if (runs.length === 0) return null;
  const ledger = await getOrgImpactLedger(org).catch(() => null);
  return countKioskRuns(runs, ledger);
}
