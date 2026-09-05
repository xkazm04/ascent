// Shared bits for the Teams tab (plain module — imported by both server components and the client
// matrix, so no "use client" here).

/** Stable DOM anchor for a team's row in the TeamsMatrix, so signal callouts can deep-link to it. */
export function teamAnchorId(slug: string): string {
  return `team-${slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}
