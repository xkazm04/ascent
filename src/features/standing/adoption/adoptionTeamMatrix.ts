// Per-team adoption as a MATRIX view model — and the tab's one real correctness fix.
//
// THE VOID-VS-ZERO CONFLATION, found and encoded here.
// `rollupTeams` (src/lib/db/org-teams.ts) computes `aiCommitShare = totCommits ? … : 0` over the
// team's merged contributor rows, and keeps any team with a live-scored repo. A team whose repos
// were scanned WITHOUT commit history therefore arrives as `contributors: 0, aiContributors: 0,
// aiCommitShare: 0` — and the old meter row painted that with `scoreHex(0)`, an alarm-red bar reading
// "0% · 0/0", pixel-identical to a team measured at a genuine 0% across five hundred commits. One is
// "we looked and nobody used AI"; the other is "there was nothing to take a share OF". Prose could
// not have separated them and the meter did not try.
//
// `contributors === 0` is an exact discriminator, not a heuristic: the team's commit totals are
// summed over the same people map, so no contributor rows means no commits by construction. Those
// teams become `not-judged` — hatched, and `rendersValue` stops any numeral being printed on them.
//
// Pure: no React. MatrixGrid paints from the states this returns.

import type { MatrixRow, VizState } from "@/components/org/viz";
import type { AdoptionOverview } from "@/lib/org/adoption";

type AdoptionTeam = AdoptionOverview["teams"][number];

/** Column order. Two shares, both 0..100, so one axis reading serves both cells. */
export const TEAM_AXES = ["AI commits", "AI-active"] as const;

/** How many teams the card plots before deferring to the Teams tab. */
export const TEAM_SHOW_LIMIT = 8;

/** A team with no contributor attribution has nothing to take a share of — never a measured 0%. */
export function teamState(t: Pick<AdoptionTeam, "contributors">): VizState {
  return t.contributors > 0 ? "measured" : "not-judged";
}

function activeShare(t: AdoptionTeam): number {
  if (t.contributors <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((t.aiContributors / t.contributors) * 100)));
}

/**
 * One `MatrixRow` per team, highest AI commit share first (the producer already sorts). A
 * `not-judged` row carries no `score` at all — the cell is hatched and prints nothing, which is the
 * whole point of routing this through the state vocabulary instead of a number.
 */
export function teamMatrixRows(teams: AdoptionTeam[], limit = TEAM_SHOW_LIMIT): MatrixRow[] {
  return teams.slice(0, limit).map((t) => {
    const state = teamState(t);
    const scored = state === "measured";
    return {
      id: t.slug,
      label: t.name,
      cells: [
        { state, score: scored ? t.aiCommitShare : null },
        { state, score: scored ? activeShare(t) : null },
      ],
    };
  });
}

/** Only the states actually present, in chart order — the Legend contract (never a static six rows). */
export function teamMatrixStates(rows: MatrixRow[]): VizState[] {
  const order: VizState[] = ["measured", "not-judged"];
  return order.filter((s) => rows.some((r) => r.cells.some((c) => c.state === s)));
}

/** Teams the matrix could not judge — surfaced as a count beside the chart, never as a 0% row. */
export function unjudgedTeamCount(teams: AdoptionTeam[], limit = TEAM_SHOW_LIMIT): number {
  return teams.slice(0, limit).filter((t) => teamState(t) === "not-judged").length;
}
