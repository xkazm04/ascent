// The Overview fleet panel's scoped-empty decision, kept out of the .tsx so the no-jsdom suite can
// pin it. `getOrgRollup` returns null only when the DB/org is missing. A scoped miss (segment/stack
// matching no repos) returns a real rollup with an empty `repos` array — the layout's unscoped
// header summary is why this panel still mounted. Treating only `null` as empty handed that rollup
// to OverviewLedger, which printed a fake 0 fleet (0/0 scanned, empty posture) instead of the copy
// that already names the miss.

/** The existing page-scale empty copy. Unchanged wording — the bug was not reaching it. */
export const OVERVIEW_SCOPED_EMPTY = {
  title: "No data for this view",
  body: "No scans match the selected period or segment yet. Widen the time range, clear the segment filter, or scan some repositories to populate the dashboard.",
  cta: "View repositories",
} as const;

/** True when the scoped rollup matched no repos — same empty as a missing rollup.
 *  Predicates `null` so the ledger branch sees a rollup, not `OrgRollup | null`. An empty-`repos`
 *  object takes the empty path and is never read again. */
export function isOverviewScopedEmpty(
  rollup: { repos: readonly unknown[] } | null,
): rollup is null {
  return !rollup || rollup.repos.length === 0;
}
