// C6: Team & CODEOWNERS rollups across the fleet. Every rollup in the org-*.ts family aggregates by
// repo or by individual contributor; this one aggregates by TEAM, using the CODEOWNERS attribution
// captured at scan time (RepoTeam). A repo is attributed to every team that owns part of it, so each
// team's Adoption×Rigor, dimension gaps, movers, and AI-knowledge roll up across the repos it's
// responsible for — mapping a repo-centric dashboard onto how the org is actually structured. Inputs,
// not rankings: the headline surfaces which team carries the most institutional AI knowledge and one
// concrete pairing to spread it, never a leaderboard. All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { segmentScope } from "@/lib/db/org-shared";
import { DIMENSION_BY_ID, postureFor } from "@/lib/maturity/model";
import { teamDisplayName } from "@/lib/github/codeowners";
import type { DimensionId } from "@/lib/types";
import { isBot } from "@/lib/db/org-shared";

const TEAM_STRONG = 65; // a team "exemplifies" a dimension at/above this (a mentor candidate)
const TEAM_WEAK = 50; // a team could grow a dimension below this (a learner candidate)

export interface TeamDimAvg {
  dimId: string;
  label: string;
  avg: number;
}

export interface TeamRepoScore {
  fullName: string;
  name: string;
  overall: number;
  adoption: number;
  rigor: number;
  level: string;
  posture: string;
  isDefaultOwner: boolean; // this team owns the repo's "*" catch-all (its primary owner)
}

export interface TeamChampion {
  login: string;
  name: string | null;
  aiCommits: number;
  aiShare: number; // 0..100 of this person's commits that are AI-attributed
}

export interface TeamRollup {
  slug: string; // "@org/team"
  name: string; // display: the segment after the last "/"
  repoCount: number; // owned repos that have a scan (drive the averages)
  totalOwned: number; // owned repos total, incl. not-yet-scanned
  defaultOwnerCount: number; // owned repos where this team is the primary ("*") owner
  repos: TeamRepoScore[]; // owned + scanned repos, strongest overall first
  avgOverall: number;
  avgAdoption: number;
  avgRigor: number;
  posture: string; // posture id from the team's avg adoption/rigor
  dimAverages: TeamDimAvg[]; // by dimId
  strongest: TeamDimAvg | null; // the team's best dimension — what others could learn from it
  weakest: TeamDimAvg | null; // the team's softest dimension — where it could grow
  // Institutional AI knowledge — from the team's repos' contributor snapshots (humans only).
  contributors: number;
  aiContributors: number; // humans with ≥1 AI-attributed commit
  aiCommitShare: number; // 0..100, commit-weighted across the team's repos
  champions: TeamChampion[]; // top humans by AI commits — the culture carriers
  knowledgeScore: number; // 0..100 blend of aiCommitShare + avgAdoption ("most AI knowledge")
  // Movers ("since last scan"): per-repo latest-vs-previous overall delta, aggregated.
  comparedRepos: number;
  improving: number;
  declining: number;
  avgDelta: number; // mean overall delta across comparedRepos
}

/** A suggested cross-team pairing: a team strong on a dimension next to one weak on the same one. */
export interface TeamPairing {
  mentorSlug: string;
  mentorName: string;
  learnerSlug: string;
  learnerName: string;
  dimId: string;
  label: string;
  mentorScore: number;
  learnerScore: number;
  gap: number;
}

export interface OrgTeamRollup {
  org: string;
  source: "codeowners";
  teamCount: number;
  attributedRepos: number; // scanned repos with ≥1 CODEOWNERS team
  unownedRepos: number; // scanned repos with no CODEOWNERS team
  teams: TeamRollup[]; // sorted: most repos first, then maturity
  /** The team whose recent work is most AI-attributed and whose repos are most AI-native — an input
   *  for "who could mentor", never a ranking. Null when no team shows AI activity. */
  knowledgeLeader: {
    slug: string;
    name: string;
    aiCommitShare: number;
    avgAdoption: number;
    knowledgeScore: number;
  } | null;
  /** The single highest-leverage cross-team pairing. An invitation to pair, not a directive. Null
   *  when no clear strong→weak gap exists on any shared dimension. */
  pairing: TeamPairing | null;
}

/** The per-repo data the team rollup aggregates over (one row per repo; scans most-recent first). */
export interface TeamRollupRepoInput {
  fullName: string;
  name: string;
  teams: { slug: string; ownedPaths: number; isDefaultOwner: boolean }[];
  scans: {
    overallScore: number;
    adoptionScore: number;
    rigorScore: number;
    level: string;
    posture: string;
    dimensions: { dimId: string; score: number }[];
  }[];
  contributors: { login: string; name: string | null; commits: number; aiCommits: number }[];
}

interface TeamAcc {
  slug: string;
  repos: TeamRepoScore[];
  totalOwned: number;
  defaultOwnerCount: number;
  dim: Map<string, { sum: number; n: number }>;
  deltas: number[];
  people: Map<string, { login: string; name: string | null; commits: number; aiCommits: number }>;
}

/**
 * Pure aggregation behind getOrgTeamRollup — exported for unit testing (no DB). Buckets each repo
 * into every team that owns it (from CODEOWNERS), then rolls each team up: maturity averages,
 * per-dimension averages (strongest/weakest), merged human contributor AI-knowledge, and
 * since-last-scan movers. Finally derives the org-level knowledge leader and one suggested pairing.
 */
export function rollupTeams(orgSlug: string, repos: TeamRollupRepoInput[]): OrgTeamRollup {
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

  const acc = new Map<string, TeamAcc>();
  let attributedRepos = 0;
  let unownedRepos = 0;

  for (const r of repos) {
    const latest = r.scans[0];
    const prev = r.scans[1];
    const hasTeams = r.teams.length > 0;
    if (latest) {
      if (hasTeams) attributedRepos += 1;
      else unownedRepos += 1;
    }
    if (!hasTeams) continue; // unowned repos belong to no team

    for (const t of r.teams) {
      const a: TeamAcc =
        acc.get(t.slug) ??
        { slug: t.slug, repos: [], totalOwned: 0, defaultOwnerCount: 0, dim: new Map(), deltas: [], people: new Map() };
      a.totalOwned += 1;
      if (t.isDefaultOwner) a.defaultOwnerCount += 1;

      if (latest) {
        a.repos.push({
          fullName: r.fullName,
          name: r.name,
          overall: latest.overallScore,
          adoption: latest.adoptionScore,
          rigor: latest.rigorScore,
          level: latest.level,
          posture: latest.posture,
          isDefaultOwner: t.isDefaultOwner,
        });
        for (const d of latest.dimensions) {
          const e = a.dim.get(d.dimId) ?? { sum: 0, n: 0 };
          e.sum += d.score;
          e.n += 1;
          a.dim.set(d.dimId, e);
        }
        if (prev) a.deltas.push(latest.overallScore - prev.overallScore);
        // Merge the repo's contributors into the team (humans only; a person across N of the team's
        // repos is one team member with summed commits).
        for (const c of r.contributors) {
          if (isBot(c.login)) continue;
          const p = a.people.get(c.login) ?? { login: c.login, name: c.name, commits: 0, aiCommits: 0 };
          p.commits += c.commits;
          p.aiCommits += c.aiCommits;
          if (!p.name && c.name) p.name = c.name;
          a.people.set(c.login, p);
        }
      }
      acc.set(t.slug, a);
    }
  }

  const teams: TeamRollup[] = [...acc.values()]
    .map((a) => {
      const teamRepos = [...a.repos].sort((x, y) => y.overall - x.overall);
      const avgOverall = avg(teamRepos.map((r) => r.overall));
      const avgAdoption = avg(teamRepos.map((r) => r.adoption));
      const avgRigor = avg(teamRepos.map((r) => r.rigor));
      const dimAverages: TeamDimAvg[] = [...a.dim.entries()]
        .map(([dimId, { sum, n }]) => ({
          dimId,
          label: DIMENSION_BY_ID[dimId as DimensionId]?.name ?? dimId,
          avg: Math.round(sum / n),
        }))
        .sort((x, y) => x.dimId.localeCompare(y.dimId));
      const byScore = [...dimAverages].sort((x, y) => y.avg - x.avg);

      const people = [...a.people.values()];
      const totCommits = people.reduce((s, p) => s + p.commits, 0);
      const totAi = people.reduce((s, p) => s + p.aiCommits, 0);
      const aiContributors = people.filter((p) => p.aiCommits > 0).length;
      const aiCommitShare = totCommits ? Math.round((totAi / totCommits) * 100) : 0;
      const champions: TeamChampion[] = people
        .filter((p) => p.aiCommits > 0)
        .sort((x, y) => y.aiCommits - x.aiCommits)
        .slice(0, 3)
        .map((p) => ({
          login: p.login,
          name: p.name,
          aiCommits: p.aiCommits,
          aiShare: p.commits ? Math.round((p.aiCommits / p.commits) * 100) : 0,
        }));
      // Blend "how much of the team's recent work is AI-attributed" with "how AI-native its repos'
      // tooling is" — two equal, explainable inputs, not an opaque score.
      const knowledgeScore = Math.round(aiCommitShare * 0.5 + avgAdoption * 0.5);

      return {
        slug: a.slug,
        name: teamDisplayName(a.slug),
        repoCount: teamRepos.length,
        totalOwned: a.totalOwned,
        defaultOwnerCount: a.defaultOwnerCount,
        repos: teamRepos,
        avgOverall,
        avgAdoption,
        avgRigor,
        posture: postureFor(avgAdoption, avgRigor).id,
        dimAverages,
        strongest: byScore[0] ?? null,
        weakest: byScore[byScore.length - 1] ?? null,
        contributors: people.length,
        aiContributors,
        aiCommitShare,
        champions,
        knowledgeScore,
        comparedRepos: a.deltas.length,
        improving: a.deltas.filter((d) => d > 0).length,
        declining: a.deltas.filter((d) => d < 0).length,
        avgDelta: a.deltas.length ? Math.round(a.deltas.reduce((s, d) => s + d, 0) / a.deltas.length) : 0,
      };
    })
    .filter((t) => t.repoCount > 0) // only teams with a scored repo carry meaningful metrics
    .sort((a, b) => b.repoCount - a.repoCount || b.avgOverall - a.avgOverall || a.slug.localeCompare(b.slug));

  // Knowledge leader: the team carrying the most institutional AI knowledge. Requires real AI
  // activity so an all-manual fleet surfaces none (no false "leader").
  const knowledgeLeader =
    [...teams]
      .filter((t) => t.aiContributors > 0)
      .sort((a, b) => b.knowledgeScore - a.knowledgeScore || b.aiCommitShare - a.aiCommitShare)[0] ?? null;

  // Pairing: the biggest learnable gap on a single shared dimension — a strong team next to a weak
  // one. Surfaces "who to pair next" as an invitation, scanning every dimension any team is scored on.
  let pairing: TeamPairing | null = null;
  if (teams.length >= 2) {
    const allDims = new Set<string>();
    for (const t of teams) for (const d of t.dimAverages) allDims.add(d.dimId);
    let best: TeamPairing | null = null;
    for (const dimId of allDims) {
      const scored = teams
        .map((t) => ({ t, d: t.dimAverages.find((x) => x.dimId === dimId) }))
        .filter((x): x is { t: TeamRollup; d: TeamDimAvg } => !!x.d);
      if (scored.length < 2) continue;
      const sorted = [...scored].sort((a, b) => b.d.avg - a.d.avg);
      const mentor = sorted[0]!; // safe: scored.length >= 2 checked above
      const learner = sorted[sorted.length - 1]!; // safe: scored.length >= 2 checked above
      if (mentor.t.slug === learner.t.slug) continue;
      if (mentor.d.avg < TEAM_STRONG || learner.d.avg >= TEAM_WEAK) continue; // need a real strong→weak gap
      const gap = mentor.d.avg - learner.d.avg;
      if (!best || gap > best.gap) {
        best = {
          mentorSlug: mentor.t.slug,
          mentorName: mentor.t.name,
          learnerSlug: learner.t.slug,
          learnerName: learner.t.name,
          dimId,
          label: mentor.d.label,
          mentorScore: mentor.d.avg,
          learnerScore: learner.d.avg,
          gap,
        };
      }
    }
    pairing = best;
  }

  return {
    org: orgSlug,
    source: "codeowners",
    teamCount: teams.length,
    attributedRepos,
    unownedRepos,
    teams,
    knowledgeLeader: knowledgeLeader
      ? {
          slug: knowledgeLeader.slug,
          name: knowledgeLeader.name,
          aiCommitShare: knowledgeLeader.aiCommitShare,
          avgAdoption: knowledgeLeader.avgAdoption,
          knowledgeScore: knowledgeLeader.knowledgeScore,
        }
      : null,
    pairing,
  };
}

/**
 * Team-level rollup across the org's fleet, keyed by CODEOWNERS team attribution. Pulls each repo's
 * teams, its latest two scans (for since-last-scan movers), and its contributor snapshots in one
 * query, then aggregates per team via rollupTeams. Null when persistence is off or the org is
 * unknown; an org with no CODEOWNERS teams returns a populated shape with `teams: []`.
 */
export async function getOrgTeamRollup(orgSlug: string, segmentId?: string | null): Promise<OrgTeamRollup | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId) },
    select: {
      fullName: true,
      name: true,
      teams: { select: { slug: true, ownedPaths: true, isDefaultOwner: true } },
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 2,
        select: {
          overallScore: true,
          adoptionScore: true,
          rigorScore: true,
          level: true,
          posture: true,
          dimensions: { select: { dimId: true, score: true } },
        },
      },
      contributors: { select: { login: true, name: true, commits: true, aiCommits: true } },
    },
  });

  return rollupTeams(orgSlug, repos);
}
