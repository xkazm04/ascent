// WHY a repo was not scanned — the honest vocabulary, in one place.
//
// The import route emits three distinct per-repo skip reasons on the `repo` frame:
//   • "insufficient_credits" — the prepaid balance (plus included allowance) ran out mid-batch;
//   • "monthly_quota"        — the FREE monthly public-scan allowance ran out (public funnel only);
//   • "in_progress"          — another live run already holds the claim for this (org, repo).
// …plus two batch-level `notice` reasons that are not per-repo at all ("too_many_repos",
// "listing_truncated").
//
// The wizard used to render EVERY truthy `skipped` as "skipped (out of credits)" and relabel every
// unreported leftover row as `insufficient_credits`. So a public-funnel user who exhausted the free
// monthly allowance — a user the select step explicitly told "no prepaid credits are used" — was sent
// to top up a prepaid balance that has nothing to do with their situation, and a repo skipped merely
// because a second tab was already scanning it was reported as a billing problem. Each reason has a
// different recovery, so each reason gets its own words.

/** Reasons a row can carry. Unknown strings are tolerated (the server may add reasons) and fall
 *  through to the neutral "not scanned", which claims nothing rather than guessing wrong. */
export const SKIP_REASONS = ["insufficient_credits", "monthly_quota", "in_progress", "not_scanned"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** The short label a skipped ROW shows. Neutral for anything unrecognized. */
export function skipRowLabel(reason: string): string {
  switch (reason) {
    case "insufficient_credits":
      return "skipped (out of credits)";
    case "monthly_quota":
      return "skipped (monthly free scans used up)";
    case "in_progress":
      return "skipped (already being scanned)";
    default:
      return "not scanned";
  }
}

/** A batch-level `notice` from the import stream, kept verbatim so nothing is silently swallowed. */
export interface ImportNotice {
  reason: string;
  scanning: number;
  skipped: number;
}

/**
 * The reason to attribute to rows the stream never reported. The server emits no `repo` frame for the
 * repos it sliced off the batch, so the leftovers must be resolved to SOMETHING — but "credits" is
 * only correct when the run actually hit the credit cap. Take the reason from the last capping notice
 * the server sent; with none, say nothing more than "not scanned".
 */
export function leftoverSkipReason(notices: ImportNotice[]): SkipReason {
  for (let i = notices.length - 1; i >= 0; i -= 1) {
    const n = notices[i];
    if (!n || n.skipped <= 0) continue;
    if (n.reason === "insufficient_credits" || n.reason === "monthly_quota" || n.reason === "in_progress") {
      return n.reason;
    }
    if (n.reason === "too_many_repos") return "not_scanned";
  }
  return "not_scanned";
}

/** How many rows carry each skip reason. Rows are the truth (every capped repo lands as a row), so the
 *  done screen's banners count these rather than the notice payloads. */
export function countSkips(rows: { skipped?: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.skipped) continue;
    counts[r.skipped] = (counts[r.skipped] ?? 0) + 1;
  }
  return counts;
}
