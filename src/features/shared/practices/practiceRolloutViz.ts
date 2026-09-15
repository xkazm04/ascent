// The Practice Library's rollout, as a matrix rather than as four stat captions.
//
// `PracticeRolloutStrip` used to carry six descriptive props — "across N playbooks", "N still in
// flight", "no repo has been scanned on both sides yet", "awaiting a post-merge rescan" — every one
// of them an epistemic qualifier delivered as prose (docs/ORG-UX-REDESIGN.md §1, anti-pattern A2).
// A practice rolling out across a fleet is a matrix: subject × stage, each cell in one of the four
// states the /org kit already defines. So it is drawn.
//
// THE CORRECTNESS FIX. The old strip (and the ledger's adoption column beside it) could not tell
// "no repository has adopted this" apart from "no repository has ever been ASSESSED for it".
// `getOrgPractices` builds `total` from repos whose LATEST scan carries dimensions, so an unscanned
// repo silently leaves the denominator: a practice measured on 2 of 41 repos rendered the same
// 100%-wide meter as one measured on 41 of 41. `Assessed` is now its own column, and a practice no
// repo has been scored on is `not-judged` — hatched, and `rendersValue` is false for that state, so
// the cell STRUCTURALLY cannot print a number. The guarantee is an invariant, not a caption.
//
// SCORES ON TWO COLUMNS ONLY. `Assessed` (share of the fleet scored on this dimension) and `Adopted`
// (share of the assessed repos that embody it) are genuine 0..100 readings over repositories, which
// is the red→green maturity ramp's home. `Landed` and `Verified` count pull requests, not maturity —
// painting a PR count on that ramp would report a young rollout as a failing one, the same misreading
// PracticesTab's own `READING_HUE` comment guards the tiles against. They carry state and no number.
//
// Pure: no React, no fetch, no hooks. The kit types are `import type`, so nothing client-side is
// pulled in by importing this module.

import type { MatrixCell, MatrixRow, VizState } from "@/components/org/viz";
import type { PracticeRow } from "./practiceRows";

/** The four stages a practice passes through, left to right. */
export const ROLLOUT_AXES = ["Assessed", "Adopted", "Landed", "Verified"] as const;

/** Rows drawn at once. The matrix is a reading, not the index — the ledger below is the index. */
export const ROLLOUT_LIMIT = 8;

/** Row labels are drawn into a 104-unit gutter at 10px; longer names would run into the first cell. */
export const LABEL_MAX = 18;

/**
 * The (D) Disclosed destinations for the strip's demoted captions — one sentence per column, carried
 * by a `WhyChip` beside the matrix. Each is reachable on focus and absent at first sight.
 */
export const ROLLOUT_HINT: Record<(typeof ROLLOUT_AXES)[number], string> = {
  Assessed:
    "Share of the fleet scored on this practice's dimension. A hatched cell means no repository has been assessed at all — which is not the same as none having adopted it, and is why this column exists.",
  Adopted:
    "A solid cell is measured from repository scans. A dashed cell is a declared application of an org-authored standard: somebody recorded applying it, and nothing has since observed it in the repo.",
  Landed:
    "Starter pull requests this practice opened. Dashed means PRs are in flight and none has landed; an empty cell means the practice was never applied here, which is never the same as applied and failed.",
  Verified:
    "A landed change is verified only by a scan on both sides of it. Hatched means no post-merge rescan has happened yet, so no lift can be reported — an absence, never a zero.",
};

/** Clamped share, with a denominator that can never be smaller than the part it contains. */
function share(part: number, whole: number): number {
  const denom = Math.max(whole, part);
  return denom <= 0 ? 0 : Math.min(100, Math.round((100 * part) / denom));
}

export function truncateLabel(label: string, max = LABEL_MAX): string {
  return label.length <= max ? label : `${label.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A MINED practice: scan-derived on both of its first two axes.
 *
 * `total === 0` is the never-assessed case and takes BOTH of them to `not-judged` — there is no
 * denominator, so there is no percentage to print and the hatch refuses to print one.
 */
function minedCells(row: PracticeRow, fleetSize: number): MatrixCell[] {
  const p = row.mined!;
  const assessed: MatrixCell =
    p.total === 0 ? { state: "not-judged" } : { state: "measured", score: share(p.total, fleetSize) };
  const adopted: MatrixCell =
    p.total === 0 ? { state: "not-judged" } : { state: "measured", score: share(p.strongCount, p.total) };

  const ro = row.rollout;
  const opened = ro ? ro.open + ro.merged : 0;
  const landed: MatrixCell =
    opened === 0 ? { state: "missing" } : ro!.merged === 0 ? { state: "declared" } : { state: "measured" };
  const verified: MatrixCell =
    !ro || ro.merged === 0 ? { state: "missing" } : ro.lift == null ? { state: "not-judged" } : { state: "measured" };
  return [assessed, adopted, landed, verified];
}

/**
 * An AUTHORED playbook: nothing scans a repository for compliance with a standard the org wrote, so
 * `Assessed` is `not-judged` for every one of them — the hatch says, without a sentence, that the
 * adoption figure beside it is a record of applications and not an observation of the repo. `Landed`
 * is a void because playbook applications bypass the `ImprovementPr` lifecycle entirely: we have no
 * measurement, which is not a zero.
 */
function authoredCells(row: PracticeRow, fleetSize: number): MatrixCell[] {
  const a = row.authored?.adoption;
  const repos = a?.repos ?? 0;
  const verified: MatrixCell =
    repos === 0 ? { state: "missing" } : (a?.measured ?? 0) === 0 ? { state: "not-judged" } : { state: "measured" };
  return [
    { state: "not-judged" },
    { state: "declared", score: share(repos, fleetSize) },
    { state: "missing" },
    verified,
  ];
}

/**
 * The matrix rows, in the ledger's own order (the org's own standards first, then the widest mined
 * reuse opportunity), capped at {@link ROLLOUT_LIMIT} so the grid stays a reading.
 */
export function rolloutMatrixRows(
  rows: readonly PracticeRow[],
  fleetSize: number,
  limit = ROLLOUT_LIMIT,
): MatrixRow[] {
  return rows.slice(0, limit).map((r) => ({
    id: r.key,
    label: truncateLabel(r.label),
    cells: r.source === "mined" && r.mined ? minedCells(r, fleetSize) : authoredCells(r, fleetSize),
  }));
}

/** Only the states these rows actually contain, in kit order — the `Legend` contract. */
export function rolloutVizStates(rows: readonly MatrixRow[]): VizState[] {
  const present = new Set<VizState>(rows.flatMap((r) => r.cells.map((c) => c.state)));
  return (["measured", "declared", "not-judged", "missing"] as VizState[]).filter((s) => present.has(s));
}

/** "8 of 14 practices · 41 repos" — unit and window, never meaning (§2.3). */
export function rolloutScopeLine(shown: number, total: number, fleetSize: number): string {
  const practices = shown < total ? `${shown} of ${total} practices` : `${total} practice${total === 1 ? "" : "s"}`;
  return `${practices} · ${fleetSize} repo${fleetSize === 1 ? "" : "s"}`;
}
