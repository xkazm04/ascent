/**
 * Minimum contributor population before naming AI "champions" is meaningful rather than a
 * surveillance-y ranking. Below this, a single AI user becomes a celebrated "#1 ★ champion" and the
 * fleet reads as 100%-adopted — success theater. The guard must be applied IDENTICALLY everywhere
 * champions are surfaced (Contributors, Adoption, Teams) so the org can't dodge it on one tab.
 */
export const CHAMPION_MIN_POP = 3;

/**
 * The floor as a predicate, so the guarantee is enforced by the DATA PRODUCERS (getContributorInsights,
 * rollupTeams) rather than re-implemented at each call site. Every surface that names an individual —
 * page, card, CSV export, PDF brief, digest — reads a producer that already applied this, so a new
 * consumer cannot forget the guard (three of them already had). Consumers may still call it to choose
 * *copy* ("suppressed" vs "no data"), never to re-derive the data.
 */
export function canNameIndividuals(population: number): boolean {
  return population >= CHAMPION_MIN_POP;
}

/**
 * Minimum commits before a person is ELIGIBLE for the champions ranking. One or two AI-tagged
 * commits is an experiment, not a carried habit — without a floor, a drive-by contributor with a
 * single Copilot commit ranks as a "100% AI" champion above people doing sustained work.
 */
export const MIN_CHAMPION_COMMITS = 3;

/**
 * How many champions a surface names. Enough to show a cohort ("these are the culture carriers"),
 * small enough that inclusion stays meaningful and the grid never degenerates into a ranked list of
 * most of the team — which would defeat the not-a-scoreboard framing above.
 */
export const CHAMPION_LIMIT = 6;

// ── WITHHELD IS NOT MISSING ──────────────────────────────────────────────────
//
// Everywhere the floor above suppresses a LIST, the suppression is self-describing: an empty
// `champions`/`contributors` array beside `namingAllowed: false` says "withheld", and an empty array
// beside `namingAllowed: true` says "no data". A suppressed SCALAR has no such shape. The per-repo
// `topLogin` used to be exactly that: a bare `"—"` string that meant BOTH "population below the
// naming floor, so we are protecting this person" and "this repo has no attributed commit data".
// One string, two meanings, no way to tell them apart — which made the privacy guarantee
// unverifiable from the payload (an auditor reading a JSON export could not prove suppression ever
// ran) and made honest copy impossible to write, because the field did not carry the distinction.
//
// The fix is a state beside the string, not a second sentinel string. See the placeholder below.

/**
 * Why a suppressed-or-absent individual field is not a name.
 *
 * - `named` — the accompanying string IS a real login.
 * - `withheld` — a real individual exists, but the population is under {@link CHAMPION_MIN_POP} and
 *   the PRODUCER suppressed the identity. The finding (concentration, bus factor, risk band) is
 *   still computed and still emitted: suppression removes the identity, never the finding.
 * - `unknown` — there is nobody to name (no attributed commit data at all).
 */
export type TopContributorState = "named" | "withheld" | "unknown";

/**
 * What a withheld or absent individual renders as, unchanged from before this state existed.
 *
 * It is deliberately the SAME "—" for both non-named states, where the obvious move would be a new
 * distinguishing sentinel ("[withheld]"). A new sentinel string would leak straight through every
 * consumer that renders `topLogin` raw — `ContributorsConcentrationTable` does — turning a data-model
 * improvement into a user-visible regression the moment it shipped. So the string stays a neutral
 * placeholder and {@link TopContributorState} carries the meaning: consumers branch on the STATE and
 * call {@link topContributorLabel} for copy; nobody string-compares "—" to detect suppression.
 * Trade-off accepted: a consumer that never adopts the state keeps the old, undifferentiated display
 * — no worse than today, and it cannot show anyone a sentinel meant for machines.
 */
export const TOP_CONTRIBUTOR_PLACEHOLDER = "—";

/**
 * The honest one-line label for a per-repo top contributor. Lives here, beside the floor it explains,
 * so every surface tells the reader the same thing about the same state rather than each inventing
 * its own phrasing for "—".
 */
export function topContributorLabel(row: { topLogin: string; topLoginState: TopContributorState }): string {
  switch (row.topLoginState) {
    case "named":
      return row.topLogin;
    case "withheld":
      return `name withheld — population below the naming floor (under ${CHAMPION_MIN_POP} contributors)`;
    case "unknown":
      return "no contributor data";
  }
}
