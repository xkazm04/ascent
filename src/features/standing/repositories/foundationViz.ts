// The foundation rollout's headline reading, as three axes rather than as a legend paragraph.
//
// The panel used to close with: "— under Conformance means NEVER REPORTED, not 0%. Not provisioned
// means Ascent has written no report-back secrets here — the repo may still run .ai/doctor.mjs
// locally." Both sentences are epistemic qualifiers about ABSENCE, which is precisely what the /org
// kit's state vocabulary encodes (docs/ORG-UX-REDESIGN.md §2.4) — so they are drawn now, and the
// promise is an invariant rather than a caption: `rendersValue` is false for both states, so those
// cells STRUCTURALLY cannot print a number.
//
// A CORRECTNESS FIX rides along, and it is the reason this module exists rather than a `<span>`:
//
//   `foundation.pr_opened` records that Ascent opened a **draft** PR (src/lib/github/write.ts sends
//   `draft: true`). The panel rendered that as "Installed", in emerald, and the bulk button as
//   "Foundation installed everywhere". A draft PR nobody merged is a CLAIM about the fleet, not an
//   observation of it — exactly the `declared` state ("declared in configuration but never observed
//   being enforced"). And the absence of an Ascent PR is not "not installed" either: a team that
//   hand-committed `.ai/` is invisible to this join (see the honest-nulls header on
//   src/lib/db/org-foundation.ts), so an empty cell there is `not-judged` — never judged, never as a
//   zero. Conflating "we opened no PR" with "this repo has no foundation" is the same class of error
//   as reading a dash as a zero, one column to the left.
//
// Pure: no React, no fetch. The kit types are `import type`, so nothing client-side is pulled in.

import type { MatrixCell, MatrixRow, VizState } from "@/components/org/viz";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";

/** The three axes, in rollout order: what we proposed, what we wired, what came back. */
export const FOUNDATION_AXES = ["PR", "Report-back", "Conformance"] as const;

/** How many repos the grid draws before deferring to the table below it. */
export const FOUNDATION_GRID_ROWS = 12;

export interface FoundationViz {
  rows: MatrixRow[];
  /** Repos beyond `FOUNDATION_GRID_ROWS`; their evidence is the table under the grid. */
  overflow: number;
  states: VizState[];
  /** Repos where Ascent opened the foundation PR — a declaration, not a merge. */
  declared: number;
  /** Repos wired to report their own conformance back. */
  provisioned: number;
  /** Repos that have actually reported at least once — the only measured cohort. */
  reporting: number;
  /** Repos Ascent has never opened a PR in, so it can say nothing about their `.ai/` layer. */
  unjudged: number;
}

function cellsFor(row: FoundationRolloutRow): MatrixCell[] {
  // `declared`, not `measured`: the PR is a draft proposal. `not-judged`, not a zero: a hand-committed
  // foundation never passes through Ascent and is unobservable here.
  const pr: MatrixCell = row.foundationPrAt ? { state: "declared" } : { state: "not-judged" };
  // Ascent wrote these secrets itself, so provisioning IS an observation. Its absence is a void:
  // "not provisioned" is not "off" — the repo may still run the doctor locally, unseen.
  const back: MatrixCell = row.reportBackAt ? { state: "measured" } : { state: "missing" };
  const conf: MatrixCell =
    typeof row.conformance === "number" ? { state: "measured", score: row.conformance } : { state: "missing" };
  return [pr, back, conf];
}

/** Least-covered first: nothing at all, then proposed-but-unwired, then wired-but-silent, then the
 *  weakest reports. The grid's top row is therefore the next repo to act on. */
function urgency(r: FoundationRolloutRow): number {
  if (!r.foundationPrAt) return 0;
  if (!r.reportBackAt) return 1;
  if (r.conformance == null) return 2;
  return 3;
}

export function foundationViz(rows: readonly FoundationRolloutRow[]): FoundationViz {
  const ordered = [...rows].sort((a, b) => {
    const t = urgency(a) - urgency(b);
    if (t !== 0) return t;
    if (a.conformance != null && b.conformance != null && a.conformance !== b.conformance)
      return a.conformance - b.conformance;
    return a.repo.localeCompare(b.repo);
  });
  const shown = ordered.slice(0, FOUNDATION_GRID_ROWS);
  const gridRows: MatrixRow[] = shown.map((r) => ({ id: r.repo, label: r.repo, cells: cellsFor(r) }));
  const present = new Set<VizState>(gridRows.flatMap((r) => r.cells.map((c) => c.state)));
  return {
    rows: gridRows,
    overflow: Math.max(0, ordered.length - shown.length),
    states: (["measured", "declared", "not-judged", "missing"] as VizState[]).filter((s) => present.has(s)),
    declared: rows.filter((r) => r.foundationPrAt != null).length,
    provisioned: rows.filter((r) => r.reportBackAt != null).length,
    reporting: rows.filter((r) => r.conformance != null).length,
    unjudged: rows.filter((r) => r.foundationPrAt == null).length,
  };
}
