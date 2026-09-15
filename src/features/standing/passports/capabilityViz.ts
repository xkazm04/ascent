// The capability matrix's headline reading, as three axes rather than as a sentence.
//
// The panel used to open with: "Every repository against its OWN .ai/manifest.yaml: what it declares
// it can do, what its doctor has proven, and where each control is enforced." That sentence names
// three axes — declared × proven × enforced — which is exactly the /org kit's primary vocabulary, so
// it is drawn instead of said (docs/ORG-UX-REDESIGN.md §2.2, §2.4).
//
// One row per capability, so the grid stays fleet-sized while the per-repo table below keeps the
// auditable rows (§2.7). Each cell is a real fraction of the ASSESSED repos — repos whose manifest
// was never read are `unassessed` in `capabilityAgg` and are in no denominator here either.
//
// Pure: no React, no fetch. The kit types are `import type`, so nothing client-side is pulled in.

import type { MatrixCell, MatrixRow, VizState } from "@/components/org/viz";
import type { CapabilityMatrix } from "./capabilityAgg";

/** The three axes, in the order the demoted sentence named them. */
export const CAPABILITY_AXES = ["Declared", "Proven", "Enforced"] as const;

const share = (part: number, whole: number): number => (whole <= 0 ? 0 : Math.round((100 * part) / whole));

/**
 * One capability's row.
 *
 * The state on each cell is the load-bearing part:
 *  - **Declared** is always `declared` (dashed outline, no fill) — a manifest entry is a claim, and
 *    the encoding says so without a caption. Its value is the share of assessed repos declaring it.
 *  - **Proven** is `not-judged` (hatched, NO number) when no repo's doctor has returned a verdict for
 *    it. A capability nobody has run structurally cannot render a passing percentage.
 *  - **Enforced** is a genuine `measured` zero when nobody wires it: the manifests' `controls` blocks
 *    were read, so 0% is an observation rather than an absence.
 *  - A capability NO assessed repo declares gets `missing` voids for Proven and Enforced — there is
 *    nothing to prove or enforce, and a void is never a zero.
 */
function rowFor(matrix: CapabilityMatrix, capability: string): MatrixRow {
  const assessed = matrix.rows.length;
  const declaring = matrix.rows.filter((r) => r.cells[capability]);
  const declaredCell: MatrixCell = { state: "declared", score: share(declaring.length, assessed) };
  if (declaring.length === 0)
    return { id: capability, label: capability, cells: [declaredCell, { state: "missing" }, { state: "missing" }] };

  // A doctor verdict exists when the cell is `verified`, or when it ran and FAILED (`failed`). A
  // `declared`/`placeholder` cell with no failure is simply un-run — evidence we do not have.
  const judged = declaring.filter((r) => r.cells[capability]!.state === "verified" || r.cells[capability]!.failed);
  const proven = declaring.filter((r) => r.cells[capability]!.state === "verified").length;
  const provenCell: MatrixCell =
    judged.length === 0 ? { state: "not-judged" } : { state: "measured", score: share(proven, declaring.length) };

  const wired = declaring.filter((r) => r.cells[capability]!.wiredAt.length > 0).length;
  return {
    id: capability,
    label: capability,
    cells: [declaredCell, provenCell, { state: "measured", score: share(wired, declaring.length) }],
  };
}

export function capabilityVizRows(matrix: CapabilityMatrix): MatrixRow[] {
  return matrix.capabilities.map((c) => rowFor(matrix, c));
}

/** Only the states these rows actually contain, in kit order — the `Legend` contract. */
export function capabilityVizStates(rows: MatrixRow[]): VizState[] {
  const present = new Set<VizState>(rows.flatMap((r) => r.cells.map((c) => c.state)));
  return (["measured", "declared", "not-judged", "missing"] as VizState[]).filter((s) => present.has(s));
}
