// Shared bits for the Teams tab (plain module — imported by both server components and the client
// matrix, so no "use client" here).

/** Stable DOM anchor for a team's row in the TeamsMatrix, so signal callouts can deep-link to it. */
export function teamAnchorId(slug: string): string {
  return `team-${slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

/**
 * What the Δ column and the tab's footnote actually compare, DERIVED from one label so they cannot
 * disagree. The footnote used to hard-code "each repo's two latest scans" while the column above it
 * was period-scoped (`comparisonLabel` from the selected window) — a caption contradicting the data
 * two sections above it, which is worse than no caption because a reader believes it.
 *
 * `deltaLabel` is the panel's: the period's `comparisonLabel` when the rollup was window-scoped, and
 * the literal "since last scan" when it was not.
 */
export function deltaFootnote(deltaLabel: string): string {
  return deltaLabel === "since last scan"
    ? "each repo's two latest scans"
    : `the selected period (${deltaLabel})`;
}
