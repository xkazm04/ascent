// The org shell's empty-org gate, as a PURE decision so it can be pinned by tests (the layout is an
// async server component the unit suite can't render).
//
// W6b dropped the blanket zero-repo wall: a MEMBER of a real-but-empty fleet org now gets the full
// shell (header + rail + tabs) with a first-scan empty state in the content slot, instead of the
// "No data for <slug>" dead end that hid the entire product until a scan existed somewhere else.
// Everything the wall used to protect is preserved:
//   - `summary === null` (no Organization row at all) stays a wall — rendering a shell for a
//     never-materialized slug would imply a tenant that doesn't exist.
//   - Non-members (simple-wall viewers browsing someone else's slug) keep the wall on an empty org,
//     so an outsider still can't distinguish "exists, empty" from "no data" any more than before.
//   - Personal workspaces keep their existing behavior: the shell always renders (the overview's
//     add-repo form IS the empty state), so they resolve to "shell" here even at zero repos.
// The DB-unreachable and no-DATABASE_URL gates are upstream of this decision and untouched.
export type OrgShellState = "wall" | "first-scan" | "shell";

export function resolveOrgShellState(args: {
  /** The header summary, or null when the org has no row/rollup at all. */
  summary: { repoCount: number; kind: string } | null;
  /** Viewer standing in THIS org: a real Membership role, or (dev-only) the auth-bypass viewer. */
  isMember: boolean;
}): OrgShellState {
  const { summary, isMember } = args;
  if (!summary) return "wall";
  if (summary.repoCount === 0 && summary.kind !== "personal") {
    return isMember ? "first-scan" : "wall";
  }
  return "shell";
}
