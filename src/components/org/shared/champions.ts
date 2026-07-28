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
