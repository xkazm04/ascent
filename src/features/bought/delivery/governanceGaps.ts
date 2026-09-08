// RepoGovernance → the cells `GovernanceGapMatrix` paints. Pure, so the one judgement call in the
// whole drawing — that "pull request required, zero approving reviews" is `declared` rather than
// `measured` — is unit-testable without rendering an SVG.
//
// That cell is the reason the matrix is worth drawing at all. A tick column can only say the repo
// requires a PR (✓) which reads as governed; the rule in fact gates nothing, because an author with
// zero required approvals merges their own work. `declared` — dashed outline, no fill — is the state
// the /org vocabulary reserves for exactly that, and it used to be a `title` attribute on a "0".

import type { RepoGovernance } from "@/lib/db";
import type { GapCell, GapRow } from "./GovernanceGapMatrix";

/** How many at-risk repos the headline graphic shows before deferring to the table below it. */
export const GAP_MATRIX_ROWS = 10;

function reviewsCell(r: RepoGovernance): GapCell {
  if (!r.requiresPullRequest) return { state: "measured", on: false };
  // Declared, not enforced: the rule exists and stops nothing.
  if (r.requiredApprovals < 1) return { state: "declared", on: false };
  return { state: "measured", on: true };
}

export function governanceGapRows(repos: RepoGovernance[], limit = GAP_MATRIX_ROWS): GapRow[] {
  return repos.slice(0, limit).map((r) => ({
    id: r.fullName,
    label: r.name,
    cells: [
      { state: "measured", on: r.protected },
      reviewsCell(r),
      { state: "measured", on: r.requiresStatusChecks },
      { state: "measured", on: r.requiresSignatures },
    ],
  }));
}
