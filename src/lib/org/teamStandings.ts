// "Why does the top team lead, and why is the bottom team at the bottom?" — a deterministic
// decomposition of the team standings, derived entirely from the scan-gathered team rollup (no LLM,
// no extra query). The Teams × dimensions table shows WHERE each team sits; this explains WHY the
// extremes sit there, by attributing each team's distance from the fleet mean to the specific
// dimensions driving it, plus the human/trajectory context (AI adoption, momentum, champions).
//
// It's an "output of the org scan" in the same sense the rollup is: a pure transform over the
// persisted per-repo scans, so it's recomputed on every scan and stays honest as teams/repos change.
// Exported pure so it can be unit-tested and serialized (the CSV export reuses `explainTeamStandings`).

import type { TeamChampion, TeamRollup } from "@/lib/db/org-teams";
import { roundedMean } from "@/lib/db/org-shared";

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
  aiCommitShare: number;
  aiShareDelta: number; // vs fleet mean aiCommitShare
  avgDelta: number; // momentum: mean overall delta since last scan
  comparedRepos: number;
  improving: number;
  declining: number;
  champions: TeamChampion[];
}

export interface TeamStandings {
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
 * dimensions driving it. Returns null when there aren't at least two teams to contrast.
 */
export function explainTeamStandings(teams: TeamRollup[]): TeamStandings | null {
  if (teams.length < 2) return null;

  const fleetAvgOverall = roundedMean(teams.map((t) => t.avgOverall));
  const fleetAiShare = roundedMean(teams.map((t) => t.aiCommitShare));

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
    aiShareDelta: t.aiCommitShare - fleetAiShare,
    avgDelta: t.avgDelta,
    comparedRepos: t.comparedRepos,
    improving: t.improving,
    declining: t.declining,
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
