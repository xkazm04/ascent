// "Why does the top team lead, and why is the bottom team at the bottom?" — a deterministic
// decomposition of the team standings, derived entirely from the scan-gathered team rollup (no LLM,
// no extra query). The Teams × dimensions table shows WHERE each team sits; this explains WHY the
// extremes sit there, by attributing each team's distance from the fleet mean to the specific
// dimensions driving it, plus the human/trajectory context (AI adoption, momentum, champions).
//
// It's an "output of the org scan" in the same sense the rollup is: a pure transform over the
// persisted per-repo scans, so it's recomputed on every scan and stays honest as teams/repos change.
// Exported pure so it can be unit-tested and serialized (the CSV export reuses `explainTeamStandings`).

import type { TeamChampion, TeamRepoScore, TeamRollup } from "@/lib/db/org-teams";
import { aiShareOf, roundedMean } from "@/lib/db/org-shared";

/** The maturity gap is composed of dimension scores, so we decompose it dimension-by-dimension: how
 *  far this team's average on a dimension sits from the fleet's average on that same dimension. */
export interface StandingFactor {
  dimId: string;
  label: string;
  teamAvg: number;
  fleetAvg: number;
  delta: number; // teamAvg - fleetAvg (signed, rounded)
}

export interface TeamStanding {
  slug: string;
  name: string;
  posture: string;
  avgOverall: number;
  /** avgOverall − fleet mean avgOverall — the gap this section explains. */
  overallDelta: number;
  /** Dimensions driving the standing, most-divergent first: for the leader the biggest positive
   *  deltas (its strengths), for the laggard the biggest negative deltas (its drags). */
  factors: StandingFactor[];
  // Human / trajectory context — separate signals, not part of the maturity-score decomposition.
  /** The team's commit-weighted AI share, or null when it has no commit population (the producer's
   *  own answer — see `TeamRollup.aiCommitShare`). Never coalesced to 0 on the way through here. */
  aiCommitShare: number | null;
  /** vs fleet mean aiCommitShare — null whenever `aiCommitShare` is, because a distance from a
   *  baseline is undefined for a team that has no reading to measure the distance from. */
  aiShareDelta: number | null;
  avgDelta: number; // momentum: mean overall delta (period-scoped when the rollup was windowed; since last scan otherwise)
  comparedRepos: number;
  improving: number;
  declining: number;
  /** Team contributor population — the renderer must gate champion naming on CHAMPION_MIN_POP
   *  (the same floor Contributors/Adoption/TeamsMatrixDetail apply), so a 1-person team's sole AI
   *  user is never crowned a champion here. (ambiguity-ui 2026-07-16 #3) */
  contributors: number;
  champions: TeamChampion[];
}

export interface TeamStandings {
  /**
   * The fleet average this section's `overallDelta` bars diverge from: the mean latest overall score
   * across the DISTINCT live-scored repos any team owns.
   *
   * It used to be `roundedMean(teams.map(t => t.avgOverall))` — a mean of team MEANS. A repo owned by
   * three CODEOWNERS teams was counted three times, a repo owned by one was counted once, and a
   * two-repo team weighed exactly as much as a forty-repo one. That number was then rendered next to
   * the org rollup's own fleet average, which is a per-repo mean, with no label distinguishing the
   * two — so the same page carried two different "fleet averages" and neither said what it was over.
   * Deduping by `fullName` and averaging the repos themselves makes this the same KIND of number as
   * the rollup's (a per-repo mean), differing only in its stated population: attributed repos.
   *
   * Mock-floor rows (`TeamRepoScore.mock`) are excluded, matching every sibling average
   * (`isMockScore` in org-rollup.ts) — a placeholder is not a measurement. Repos with no CODEOWNERS
   * team are not in this population at all; they are the rollup's `unowned` list.
   */
  fleetAvgOverall: number;
  /** Fleet mean per dimension — the baseline the factor bars diverge from. */
  fleetDimAvgs: { dimId: string; label: string; avg: number }[];
  leader: TeamStanding;
  laggard: TeamStanding;
  spread: number; // leader.avgOverall − laggard.avgOverall
  /** Largest |delta| across both teams' factors — a shared bar scale so the two sides are comparable. */
  maxAbsDelta: number;
  teamCount: number;
}

const MAX_FACTORS = 5; // dimensions shown per team — enough to explain the gap without a wall of bars

/**
 * Decompose the team standings into a leader/laggard "why" explanation. Ranks teams by avgOverall
 * (the Overall column), then attributes each extreme's distance from the fleet mean to the
 * dimensions driving it. Returns null when there aren't at least two teams to contrast, or when no
 * live-scored repo is attributed to any of them (no fleet mean ⇒ nothing for the bars to diverge from).
 */
export function explainTeamStandings(teams: TeamRollup[]): TeamStandings | null {
  if (teams.length < 2) return null;

  // Per-repo mean over the DISTINCT live-scored repos across every team — see `fleetAvgOverall`.
  // A repo shared by several teams votes ONCE, and each team's weight is its actual repo count.
  const distinctRepos = new Map<string, TeamRepoScore>();
  for (const t of teams) for (const r of t.repos) distinctRepos.set(r.fullName, r);
  const repoRows = [...distinctRepos.values()];
  const fleetAvgOverall = roundedMean(repoRows.filter((r) => !r.mock).map((r) => r.overall));
  // No live-scored repo is attributed to any team ⇒ there is no fleet mean, and this whole section is
  // nothing BUT divergence from that mean (`overallDelta`, the factor bars, `maxAbsDelta`). Returning
  // null says "nothing to contrast" the same way the two-team floor above does; the alternative — a 0
  // baseline — would print every team as +N above a fleet nobody measured. `rollupTeams` cannot
  // produce such a `teams` today (it emits no team without a live-scored repo), so this is a floor on
  // hand-built inputs, not a reachable product state.
  if (fleetAvgOverall === null) return null;
  // The AI share gets the SAME dedupe and the same commit weighting the per-team figure uses
  // (`aiCommitShare` = the team's totAi / totCommits), because `aiShareDelta` subtracts one from the
  // other and they must be the same kind of number over comparable populations. It was
  // `roundedMean(teams.map(t => t.aiCommitShare))` — the mean of team MEANS that `fleetAvgOverall`
  // above was fixed for and documents at length, left in place 38 lines below that docstring. It put
  // a two-repo team at 100% and a forty-repo team at 5% on equal footing, so the team carrying
  // almost all of the fleet's actual commits was rendered ~48 points "below the fleet" it very
  // nearly IS.
  //
  // TWO POPULATIONS, DELIBERATELY: mock-floor rows are excluded from the SCORE average (a floor is
  // not a grade) and INCLUDED here (rollupTeams merges a repo's contributors regardless of `mock`,
  // so the per-team share counts them; excluding them here would compare against a population the
  // per-team number never had). Pinned by teamStandings.test.ts.
  //
  // A team whose `aiCommitShare` is NULL needs no special case and must not get one: the weighting
  // runs over the repos' own commit totals, and a team with no commit population contributes 0 to
  // both sums — it cannot move a baseline it has no commits in. That is why the fix is a nullable
  // field rather than a filter here. Pinned by teamStandings.test.ts ("a null-share team").
  const fleetAiShare = aiShareOf(
    repoRows.reduce((s, r) => s + r.commits, 0),
    repoRows.reduce((s, r) => s + r.aiCommits, 0),
  );

  // Fleet mean per dimension, over the teams scored on it (some teams may lack a dimension).
  const dimSum = new Map<string, { label: string; sum: number; n: number }>();
  for (const t of teams) {
    for (const d of t.dimAverages) {
      const e = dimSum.get(d.dimId) ?? { label: d.label, sum: 0, n: 0 };
      e.sum += d.avg;
      e.n += 1;
      dimSum.set(d.dimId, e);
    }
  }
  const fleetDim = new Map<string, { label: string; avg: number }>();
  const fleetDimAvgs: TeamStandings["fleetDimAvgs"] = [];
  for (const [dimId, { label, sum, n }] of dimSum) {
    const avg = Math.round(sum / n);
    fleetDim.set(dimId, { label, avg });
    fleetDimAvgs.push({ dimId, label, avg });
  }
  fleetDimAvgs.sort((a, b) => a.dimId.localeCompare(b.dimId));

  // Rank by maturity (Overall), deterministic tie-break. Leader = most mature, laggard = least.
  const ranked = [...teams].sort((a, b) => b.avgOverall - a.avgOverall || a.slug.localeCompare(b.slug));
  const leaderTeam = ranked[0]!;
  const laggardTeam = ranked[ranked.length - 1]!;

  const factorsFor = (t: TeamRollup, direction: "above" | "below"): StandingFactor[] => {
    const all: StandingFactor[] = t.dimAverages.map((d) => {
      const fleetAvg = fleetDim.get(d.dimId)?.avg ?? d.avg;
      return { dimId: d.dimId, label: d.label, teamAvg: d.avg, fleetAvg, delta: d.avg - fleetAvg };
    });
    // Leader: dims it's most ABOVE the fleet on. Laggard: dims it's most BELOW on. If a team has no
    // divergence in the expected direction (e.g. the leader is above on nothing), fall back to the
    // most divergent dims by magnitude so the section is never empty.
    const dir = all.filter((f) => (direction === "above" ? f.delta > 0 : f.delta < 0));
    const picked = dir.length > 0 ? dir : all;
    picked.sort((a, b) => (direction === "above" ? b.delta - a.delta : a.delta - b.delta));
    return picked.slice(0, MAX_FACTORS);
  };

  const toStanding = (t: TeamRollup, direction: "above" | "below"): TeamStanding => ({
    slug: t.slug,
    name: t.name,
    posture: t.posture,
    avgOverall: t.avgOverall,
    overallDelta: t.avgOverall - fleetAvgOverall,
    factors: factorsFor(t, direction),
    aiCommitShare: t.aiCommitShare,
    aiShareDelta: t.aiCommitShare === null ? null : t.aiCommitShare - fleetAiShare,
    avgDelta: t.avgDelta,
    comparedRepos: t.comparedRepos,
    improving: t.improving,
    declining: t.declining,
    contributors: t.contributors,
    champions: t.champions,
  });

  const leader = toStanding(leaderTeam, "above");
  const laggard = toStanding(laggardTeam, "below");

  const maxAbsDelta = Math.max(
    1, // floor so a dead-even fleet doesn't divide by zero when scaling bars
    ...leader.factors.map((f) => Math.abs(f.delta)),
    ...laggard.factors.map((f) => Math.abs(f.delta)),
  );

  return {
    fleetAvgOverall,
    fleetDimAvgs,
    leader,
    laggard,
    spread: leaderTeam.avgOverall - laggardTeam.avgOverall,
    maxAbsDelta,
    teamCount: teams.length,
  };
}
