// ONE IMPROVEMENT LEDGER — practice PRs and local loop lanes, folded into one read model.
//
// WHY. The Impact Ledger, the programme strip and the executive briefing all counted exactly one
// population: practice PRs that merged into a default branch. A local loop lane that dispatched an
// agent, committed to a branch, rescanned that worktree and measurably moved a dimension counted
// nowhere — so the surface that answers "what did this cost and what did it buy" was blind to the
// half of the product that does the work.
//
// THE TWO BASES, AND WHY `pointsBought` STILL MEANS BOUGHT.
//
//   • `merged` — measured on the DEFAULT BRANCH after a merge. This is what a buyer means by bought:
//     the change is in the trunk, everyone has it, and the next ordinary scan sees it.
//   • `branch` — measured on a lane's own branch, from the worktree the lane scanned. Real, verified
//     movement — and NOT bought, because nothing has landed.
//
// So `pointsBought` and `ImpactRow.dimPoints` stay merged-basis only, and branch work is reported
// beside them as `inReviewPoints` / `pointsInReview`, labelled "on branches, not merged". Folding
// branch movement into the bought number would be a fabrication: it would tell a buyer they own
// something that exists only on a branch nobody has reviewed. The undercount that creates is fixed by
// the ROUTE, not by the arithmetic — once a lane's PR merges, the merged-basis row is stamped against
// the lane's own baseline and the points move across with no re-measurement.
//
// HONEST NULLS, as everywhere in the impact layer: `dimPoints: null` means "not measurable" (no
// baseline, or a missing scan end), never 0. Sign is preserved — a regression is reported as one.
// `overall` is carried per row and NEVER summed across repos, because overall scores are weighted
// per-repo and their sum is not a quantity.

/** Where an improvement came from. */
export type ImprovementSource = "practice-pr" | "loop";

/** How it was measured. `merged` = on the default branch after a merge; `branch` = on a lane branch. */
export type ImprovementBasis = "merged" | "branch";

export interface ImprovementEvent {
  /** Dedupe key: the repo plus the after-scan that measured it, or the PR when there is no scan. */
  key: string;
  source: ImprovementSource;
  basis: ImprovementBasis;
  repoFullName: string;
  /** The practice's label, or `Loop lane · cycle N`. */
  label: string;
  /** Null only when a loop lane had no dominant dimension — such a row joins no `byDim` bucket. */
  dimId: string | null;
  /** Signed movement on `dimId`. `null` = not measurable, which is not 0. */
  dimPoints: number | null;
  /** Per-row only. Never summed across repos. */
  overall: number | null;
  /** ISO — the merge time for a PR, the lane's end for a lane. */
  at: string;
  prNumber: number | null;
  prUrl: string | null;
  laneId: string | null;
  runId: string | null;
  /** True when both ends of the measurement exist. A one-ended row is awaiting its rescan. */
  verified: boolean;
}

/** A merged practice PR, as the existing impact reader already resolves one. */
export interface ImpactPrInput {
  repoFullName: string;
  label: string;
  dimId: string;
  dimPoints: number | null;
  overall: number | null;
  mergedAt: string;
  prNumber: number | null;
  prUrl: string | null;
  afterScanId: string | null;
  /** Set when this PR came from a loop lane — the join that lets the fold retire the branch row. */
  loopLaneId?: string | null;
}

/** A loop lane with its bracketing scan pair already resolved. */
export interface LaneImpactInput {
  laneId: string;
  runId: string;
  repoFullName: string;
  cycle: number;
  dimId: string | null;
  dimPoints: number | null;
  overall: number | null;
  endedAt: string | null;
  beforeScanId: string | null;
  afterScanId: string | null;
  prNumber: number | null;
  prUrl: string | null;
  /** Commits the lane landed. A lane that committed nothing measured a worktree it then deleted. */
  commits: number;
}

const prKey = (r: ImpactPrInput): string => `${r.repoFullName}#${r.afterScanId ?? `pr:${r.prNumber ?? "?"}`}`;
const laneKey = (l: LaneImpactInput): string => `${l.repoFullName}#${l.afterScanId ?? `lane:${l.laneId}`}`;

/**
 * Fold the two populations into one event list, newest first.
 *
 * THE DEDUPE IS THE POINT. A lane that became a PR that merged and verified produces BOTH a
 * branch-basis row (its own rescan) and a merged-basis row (the PR's) for the same work. Counting
 * both would double the org's improvement. The merged row wins — it is the stronger claim — and the
 * lane's branch row is dropped, matched by `loopLaneId` first and by the shared key second.
 *
 * PURE: no clock, no DB. The window filter belongs to the reader.
 */
export function foldImprovementEvents(prs: readonly ImpactPrInput[], lanes: readonly LaneImpactInput[]): ImprovementEvent[] {
  const events: ImprovementEvent[] = [];
  const seen = new Set<string>();
  /** Lanes whose work is already represented by a merged PR row. */
  const supersededLanes = new Set<string>();
  const supersededKeys = new Set<string>();

  for (const pr of prs) {
    const key = prKey(pr);
    if (seen.has(key)) continue;
    seen.add(key);
    if (pr.loopLaneId) supersededLanes.add(pr.loopLaneId);
    supersededKeys.add(key);
    events.push({
      key,
      source: pr.loopLaneId ? "loop" : "practice-pr",
      // A merged PR is merged-basis WHATEVER it came from: the basis describes where the measurement
      // was taken, not who authored the change.
      basis: "merged",
      repoFullName: pr.repoFullName,
      label: pr.label,
      dimId: pr.dimId,
      dimPoints: pr.dimPoints,
      overall: pr.overall,
      at: pr.mergedAt,
      prNumber: pr.prNumber,
      prUrl: pr.prUrl,
      laneId: pr.loopLaneId ?? null,
      runId: null,
      verified: pr.dimPoints != null,
    });
  }

  for (const lane of lanes) {
    if (supersededLanes.has(lane.laneId)) continue;
    const key = laneKey(lane);
    if (seen.has(key) || supersededKeys.has(key)) continue;
    seen.add(key);
    // BOTH ENDS OR NOTHING. `diffScans` refuses to invent a delta when one end is missing, and so does
    // this: a one-ended lane is `verified: false` with `dimPoints: null` — awaiting its rescan, which
    // is a different fact from "it moved nothing".
    const bothEnds = lane.beforeScanId != null && lane.afterScanId != null;
    events.push({
      key,
      source: "loop",
      basis: "branch",
      repoFullName: lane.repoFullName,
      label: `Loop lane · cycle ${lane.cycle}`,
      dimId: lane.dimId,
      // A lane that committed nothing scanned a worktree the run then deleted (L2-B-01), so its
      // measurement describes a state that no longer exists anywhere. Not measurable, not zero.
      dimPoints: bothEnds && lane.commits > 0 ? lane.dimPoints : null,
      overall: bothEnds && lane.commits > 0 ? lane.overall : null,
      at: lane.endedAt ?? "",
      prNumber: lane.prNumber,
      prUrl: lane.prUrl,
      laneId: lane.laneId,
      runId: lane.runId,
      verified: bothEnds && lane.commits > 0 && lane.dimPoints != null,
    });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
}

/**
 * Points on branches that have NOT merged — the in-review figure.
 *
 * `null` rather than 0 when nothing is measurable, so a surface can say "—" instead of claiming the
 * loop bought nothing. Only positive, verified, branch-basis movement counts: a regression on a
 * branch is not something "in review" to be credited, and an unmeasured lane is not a zero.
 */
export function inReviewPoints(events: readonly ImprovementEvent[]): number | null {
  const measured = events.filter((e) => e.basis === "branch" && e.verified && e.dimPoints != null);
  if (measured.length === 0) return null;
  return measured.reduce((sum, e) => sum + (e.dimPoints ?? 0), 0);
}

/** Lanes that moved something but have not been reviewed — the count beside the in-review points. */
export function inReviewLanes(events: readonly ImprovementEvent[]): number {
  return events.filter((e) => e.basis === "branch" && e.verified).length;
}
