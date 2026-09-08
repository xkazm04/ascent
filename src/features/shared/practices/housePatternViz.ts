// The house pattern's PRIVACY GUARANTEE, as a matrix.
//
// The panel used to promise it in a sentence: "Structure only: headings and layout travel between
// your repos, never an artifact's contents." Wave 1's contributors result is the reason that is not
// good enough — an absence you can SEE beats an absence you are promised. So the two kinds of
// structure that ARE read, and the one thing that is not, are drawn on the same two axes, and the
// body's row is a VOID in both columns.
//
// The void is the accurate encoding, not a stylistic one. `src/lib/analyze/practice-shape.ts` does
// not extract the body at all — it is not extracted-and-filtered, and it is not extracted-and-hidden
// — so there is nothing to paint, in exactly the way the kit's `missing` state means "no measurement
// here, and never a zero". A reader who counts the empty cells has verified the guarantee.
//
// Pure: no React, no hooks. The kit types are `import type`.

import type { MatrixRow, VizState } from "@/components/org/viz";

/** Read at scan time · travels to another repo in the same org. */
export const SHAPE_AXES = ["Read", "Travels"] as const;

export const SHAPE_PRIVACY_HINT =
  "Only a document's heading skeleton and a harness's path segments are extracted. An artifact's body — where the code, the credentials and the customer names live — is never read into a shape, so the two empty cells below are the guarantee, not a redaction.";

/**
 * The provenance caveat: this is the org's own agreement, not a vendor's template and not the
 * highest-scoring repo's copy. Takes the agreement floor so the number can never drift from
 * `MIN_AGREEMENT` by being re-typed here.
 */
export function shapeProvenanceHint(minAgreement: number): string {
  return `Mined from the structure your own strongest repositories already share, never from a generic template. A heading or path enters the pattern only when at least ${minAgreement} of them carry it independently — the n× beside each line is how many agreed — so what you see is agreement rather than one team's document promoted to a standard. Mined shapes stay inside this organization.`;
}

/**
 * Three rows, two columns. The first two are `measured` — we observed this structure in the org's
 * own repos and it is what travels. The third is `missing` twice over.
 */
export const SHAPE_PRIVACY_ROWS: MatrixRow[] = [
  {
    id: "outline",
    label: "Headings",
    cells: [{ state: "measured" }, { state: "measured" }],
  },
  {
    id: "layout",
    label: "Path layout",
    cells: [{ state: "measured" }, { state: "measured" }],
  },
  {
    id: "body",
    label: "File contents",
    cells: [{ state: "missing" }, { state: "missing" }],
  },
];

/** The states this matrix actually uses, in kit order — the `Legend` contract. */
export const SHAPE_PRIVACY_STATES: VizState[] = ["measured", "missing"];

/** "3 repositories · outline + layout" — unit and window only (§2.3). */
export function shapeScopeLine(reposWithShape: number): string {
  return `${reposWithShape} scanned ${reposWithShape === 1 ? "repository" : "repositories"} · structure only`;
}
