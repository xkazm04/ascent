// C6: Team & CODEOWNERS rollups across the fleet. Every rollup in the org-*.ts family aggregates by
// repo or by individual contributor; this one aggregates by TEAM, using the CODEOWNERS attribution
// captured at scan time (RepoTeam). A repo is attributed to every team that owns part of it, so each
// team's Adoption×Rigor, dimension gaps, movers, and AI-knowledge roll up across the repos it's
// responsible for — mapping a repo-centric dashboard onto how the org is actually structured. Inputs,
// not rankings: the headline surfaces which team carries the most institutional AI knowledge and one
// concrete pairing to spread it, never a leaderboard. All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { segmentScope, techGroupScope } from "@/lib/db/org-shared";
import { DIMENSION_BY_ID, postureFor } from "@/lib/maturity/model";
import { teamDisplayName } from "@/lib/github/codeowners";
import type { DimensionId } from "@/lib/types";
import { GroupedMean, aiShareOf, getOrgBySlug, isBot, pickChampions, roundedMean } from "@/lib/db/org-shared";
import type { OrgWindow } from "@/lib/db/org-rollup";
import { retentionCutoff } from "@/lib/plans";

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
  // Movers: per-repo overall delta, aggregated. PERIOD-SCOPED when the caller threads an OrgWindow
  // through getOrgTeamRollup (baseline = latest scan strictly before the window start — the same
  // half-open semantics as getOrgMovers, so the Teams tab agrees with every sibling tab on the
  // selected period); "since last scan" (latest vs previous, cadence-dependent) when no window is
  // given (fleet-rollups-insights 07-16 #2).
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
  /** The scanned repos behind `unownedRepos`, weakest overall first — the concrete CODEOWNERS
   *  follow-up list (which repos to attribute, starting where attention is most needed). */
  unowned: { fullName: string; name: string; overall: number }[];
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
  /** The highest-leverage cross-team pairings (best strong→weak gap per dimension, biggest gaps
   *  first, at most 3). Invitations to pair, not directives. Empty when no clear gap exists. */
  pairings: TeamPairing[];
  /** The single best pairing — `pairings[0]`, kept for existing callers. */
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
  /** Period-scoped overall delta for this repo (fleet-rollups-insights 07-16 #2).
   *  - `undefined` (field absent): NO window was requested — the legacy "since last scan" delta
   *    (scans[0] − scans[1]) applies.
   *  - `number`: the windowed delta (latest in-window scan minus the half-open baseline).
   *  - `null`: a window was requested but this repo has no comparable pair inside it — the repo is
   *    excluded from movers (never silently downgraded to since-last-scan, which would mix scopes). */
  windowDelta?: number | null;
}

interface TeamAcc {
  slug: string;
  repos: TeamRepoScore[];
  totalOwned: number;
  defaultOwnerCount: number;
  dim: GroupedMean;
  deltas: number[];
  people: Map<string, { login: string; name: string | null; commits: number; aiCommits: number }>;
}

/**
 * Pure aggregation behind getOrgTeamRollup — exported for unit testing (no DB). Buckets each repo
 * into every team that owns it (from CODEOWNERS), then rolls each team up: maturity averages,
 * per-dimension averages (strongest/weakest), merged human contributor AI-knowledge, and movers
 * (period-scoped when the caller supplies `windowDelta`; since-last-scan otherwise — see
 * TeamRollupRepoInput.windowDelta). Finally derives the org-level knowledge leader and one pairing.
 */
export function rollupTeams(orgSlug: string, repos: TeamRollupRepoInput[]): OrgTeamRollup {
  const avg = roundedMean;

  const acc = new Map<string, TeamAcc>();
  let attributedRepos = 0;
  const unowned: OrgTeamRollup["unowned"] = [];

  for (const r of repos) {
    const latest = r.scans[0];
    const prev = r.scans[1];
    const hasTeams = r.teams.length > 0;
    if (latest) {
      if (hasTeams) attributedRepos += 1;
      else unowned.push({ fullName: r.fullName, name: r.name, overall: latest.overallScore });
    }
    if (!hasTeams) continue; // unowned repos belong to no team

    for (const t of r.teams) {
      const a: TeamAcc =
        acc.get(t.slug) ??
        { slug: t.slug, repos: [], totalOwned: 0, defaultOwnerCount: 0, dim: new GroupedMean(), deltas: [], people: new Map() };
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
        for (const d of latest.dimensions) a.dim.add(d.dimId, d.score);
        // Movers: a windowed caller precomputed `windowDelta` (period-scoped; null = no comparable
        // pair in the window → excluded); otherwise fall back to the legacy since-last-scan delta.
        if (r.windowDelta !== undefined) {
          if (r.windowDelta !== null) a.deltas.push(r.windowDelta);
        } else if (prev) {
          a.deltas.push(latest.overallScore - prev.overallScore);
        }
        // Merge the repo's contributors into the team (humans only; a person across N of the team's
        // repos is one team member with summed commits). MIXED-WINDOW caveat (ambiguity-ui
        // 2026-07-16 #5): each repo's snapshot is anchored to that repo's OWN last scan, so on a
        // mixed-cadence fleet these sums blend windows of different ages — team aiCommitShare /
        // knowledgeScore describe "as of each repo's last scan", not a single instant.
        // getContributorInsights applies a ~6-month staleness horizon for the org-wide champion /
        // bus-factor view; the team rollup keeps every owned repo (dropping a team's only repo would
        // blank the team) and relies on this documented semantics instead.
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
      const dimAverages: TeamDimAvg[] = a.dim
        .entries()
        .map(([dimId, avg]) => ({
          dimId,
          label: DIMENSION_BY_ID[dimId as DimensionId]?.name ?? dimId,
          avg,
        }))
        .sort((x, y) => x.dimId.localeCompare(y.dimId));
      const byScore = [...dimAverages].sort((x, y) => y.avg - x.avg);

      const people = [...a.people.values()];
      const totCommits = people.reduce((s, p) => s + p.commits, 0);
      const totAi = people.reduce((s, p) => s + p.aiCommits, 0);
      const aiContributors = people.filter((p) => p.aiCommits > 0).length;
      const aiCommitShare = totCommits ? Math.round((totAi / totCommits) * 100) : 0;
      // Volume floor aligned with getContributorInsights' champion picker (commits >= 3 &&
      // aiCommits > 0): without it a 1-commit contributor could headline a team's standings card
      // while the Contributors tab deliberately withheld them. (ambiguity-ui 2026-07-16 #3)
      const champions: TeamChampion[] = pickChampions(people, {
        filter: (p) => p.commits >= 3 && p.aiCommits > 0,
        by: (p) => p.aiCommits,
        limit: 3,
      }).map((p) => ({
        login: p.login,
        name: p.name,
        aiCommits: p.aiCommits,
        aiShare: aiShareOf(p.commits, p.aiCommits),
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

  // Pairings: the biggest learnable gaps, one per shared dimension — a strong team next to a weak
  // one. Surfaces "who to pair next" as invitations, scanning every dimension any team is scored on;
  // the top gap stays the headline `pairing`.
  const candidates: TeamPairing[] = [];
  if (teams.length >= 2) {
    const allDims = new Set<string>();
    for (const t of teams) for (const d of t.dimAverages) allDims.add(d.dimId);
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
      candidates.push({
        mentorSlug: mentor.t.slug,
        mentorName: mentor.t.name,
        learnerSlug: learner.t.slug,
        learnerName: learner.t.name,
        dimId,
        label: mentor.d.label,
        mentorScore: mentor.d.avg,
        learnerScore: learner.d.avg,
        gap: mentor.d.avg - learner.d.avg,
      });
    }
  }
  const pairings = candidates.sort((a, b) => b.gap - a.gap || a.dimId.localeCompare(b.dimId)).slice(0, 3);

  unowned.sort((a, b) => a.overall - b.overall || a.fullName.localeCompare(b.fullName));

  return {
    org: orgSlug,
    source: "codeowners",
    teamCount: teams.length,
    attributedRepos,
    unownedRepos: unowned.length,
    unowned,
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
    pairings,
    pairing: pairings[0] ?? null,
  };
}

/**
 * Team-level rollup across the org's fleet, keyed by CODEOWNERS team attribution. Pulls each repo's
 * teams, its latest two scans, and its contributor snapshots in one query, then aggregates per team
 * via rollupTeams. Null when persistence is off or the org is unknown; an org with no CODEOWNERS
 * teams returns a populated shape with `teams: []`.
 *
 * PERIOD SCOPE (fleet-rollups-insights 07-16 #2): pass the dashboard's `window` and the movers
 * (improving/declining/avgDelta) become period-scoped — each repo compares its latest in-window scan
 * against the latest scan STRICTLY before the window start (getOrgMovers' half-open baseline, clamped
 * to the plan's retention window like every sibling aggregate). Without a window (or with "all time")
 * the legacy "since last scan" semantics apply. Snapshot fields (avgOverall, dims, contributors)
 * remain latest-scan state in both modes — only the deltas are windowed.
 */
export async function getOrgTeamRollup(
  orgSlug: string,
  segmentId?: string | null,
  techGroupId?: string | null,
  window?: OrgWindow,
): Promise<OrgTeamRollup | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
    select: {
      id: true,
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

  // Plan retention floor: like getOrgMovers, the baseline is entitlement-gated — clamp the window
  // start to the tier's retention cutoff so a Free org's 90d team movers aren't computed against
  // history the plan doesn't buy.
  const retentionStart = retentionCutoff(org.plan, Date.now());
  const rawStart = window?.start ?? null;
  const start = rawStart && retentionStart && retentionStart > rawStart ? retentionStart : rawStart;

  if (!start) return rollupTeams(orgSlug, repos);

  // Windowed movers: per repo, latest in-window scan vs the latest scan STRICTLY before `start` (the
  // half-open baseline getOrgMovers/getOrgRollup share, so a scan exactly at `start` belongs to the
  // current side on every surface). Two bounded queries — never the whole scan history.
  const end = window?.end ?? null;
  const repoScope = { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) };
  const [inWindow, preStart] = await Promise.all([
    prisma.scan.findMany({
      where: { repo: repoScope, scannedAt: { gte: start, ...(end ? { lte: end } : {}) } },
      select: { repoId: true, overallScore: true, scannedAt: true },
      orderBy: { scannedAt: "desc" },
    }),
    prisma.scan.findMany({
      where: { repo: repoScope, scannedAt: { lt: start } },
      select: { repoId: true, overallScore: true, scannedAt: true },
      orderBy: { scannedAt: "desc" },
      distinct: ["repoId"],
    }),
  ]);
  const latestIn = new Map<string, number>(); // repoId → latest in-window overall (rows are desc)
  const earliestIn = new Map<string, number>(); // repoId → earliest in-window overall
  const countIn = new Map<string, number>(); // repoId → in-window scan count
  for (const s of inWindow) {
    if (!latestIn.has(s.repoId)) latestIn.set(s.repoId, s.overallScore);
    earliestIn.set(s.repoId, s.overallScore); // last write per repo = oldest (desc order)
    countIn.set(s.repoId, (countIn.get(s.repoId) ?? 0) + 1);
  }
  const baseline = new Map<string, number>();
  for (const s of preStart) if (!baseline.has(s.repoId)) baseline.set(s.repoId, s.overallScore);

  const withDeltas: TeamRollupRepoInput[] = repos.map((r) => {
    // Mirror getOrgMovers: a repo onboarded mid-period (no pre-start scan) falls back to its earliest
    // in-window scan — it genuinely moved within the window. A repo with no in-window scan, or a
    // single in-window scan and no baseline (nothing to compare), has no pair → null (excluded).
    const now = latestIn.get(r.id);
    const prev = baseline.get(r.id) ?? earliestIn.get(r.id);
    const windowDelta =
      now == null || prev == null || (!baseline.has(r.id) && (countIn.get(r.id) ?? 0) <= 1)
        ? null
        : now - prev;
    return { ...r, windowDelta };
  });
  return rollupTeams(orgSlug, withDeltas);
}
