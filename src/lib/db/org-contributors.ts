// Contributor aggregates across an org's repos — the "who is AI-native" view and contributor
// intelligence (F5). All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { isBot, segmentScope, techGroupScope } from "@/lib/db/org-shared";

// ── Contributor intelligence (F5) ────────────────────────────────────────────
// All derived from the stored RepoContributor snapshots (latest scan per repo) — no extra
// GitHub calls. "commits"/"aiCommits" reflect the recent-activity window we capture at scan
// time. Bots ([bot]) and unattributed ("unknown") commits are excluded from the human view.

export interface ContributorInsight {
  login: string;
  name: string | null;
  commits: number;
  aiCommits: number;
  aiShare: number; // 0..100, share of this person's commits that are AI-attributed
  repos: number; // distinct repos touched
  repoNames: string[]; // sorted by that person's commits desc
  lastActiveAt: string | null;
  championScore: number; // AI adoption × breadth × volume (for ranking culture carriers)
}

export interface RepoConcentration {
  fullName: string;
  name: string;
  contributorCount: number;
  totalCommits: number;
  topLogin: string;
  topShare: number; // 0..100, the top contributor's share of commits
  busFactor: number; // # contributors needed to cover >50% of commits
  soloMaintainer: boolean; // 1 contributor, or top contributor owns ≥80%
}

export interface ContributorInsights {
  org: string;
  totalContributors: number;
  aiActive: number; // humans with ≥1 AI-attributed commit
  aiActiveShare: number; // 0..100
  orgAiShare: number; // 0..100, commit-weighted across all humans
  soloMaintainerCount: number;
  contributors: ContributorInsight[]; // all humans, sorted by commits desc
  champions: ContributorInsight[]; // top by championScore
  concentration: RepoConcentration[]; // per repo, sorted by topShare desc
}

/** Contributor involvement, AI-native profiles, champions, and bus-factor across an org. */
export async function getContributorInsights(orgSlug: string, segmentId?: string | null, techGroupId?: string | null): Promise<ContributorInsights | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const rows = await prisma.repoContributor.findMany({
    where: { repo: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) } },
    select: {
      login: true,
      name: true,
      commits: true,
      aiCommits: true,
      lastActiveAt: true,
      repo: { select: { fullName: true, name: true } },
    },
  });

  // Per-contributor aggregation (humans only).
  const people = new Map<
    string,
    { login: string; name: string | null; commits: number; aiCommits: number; repos: Map<string, number>; last: Date | null }
  >();
  // Per-repo contributor lists (humans only) for concentration / bus factor.
  const repos = new Map<string, { name: string; entries: { login: string; commits: number }[] }>();

  for (const r of rows) {
    if (isBot(r.login)) continue;
    const p =
      people.get(r.login) ??
      { login: r.login, name: r.name, commits: 0, aiCommits: 0, repos: new Map<string, number>(), last: null };
    p.commits += r.commits;
    p.aiCommits += r.aiCommits;
    p.repos.set(r.repo.fullName, (p.repos.get(r.repo.fullName) ?? 0) + r.commits);
    if (!p.name && r.name) p.name = r.name;
    if (r.lastActiveAt && (!p.last || r.lastActiveAt > p.last)) p.last = r.lastActiveAt;
    people.set(r.login, p);

    const repo = repos.get(r.repo.fullName) ?? { name: r.repo.name, entries: [] };
    repo.entries.push({ login: r.login, commits: r.commits });
    repos.set(r.repo.fullName, repo);
  }

  const contributors: ContributorInsight[] = [...people.values()]
    .map((p) => {
      const aiShare = p.commits ? Math.round((p.aiCommits / p.commits) * 100) : 0;
      const repoCount = p.repos.size;
      const repoNames = [...p.repos.entries()].sort((a, b) => b[1] - a[1]).map(([fn]) => fn);
      // Reward AI adoption × breadth × (log) volume — culture carriers spread AI across repos.
      const championScore = (aiShare / 100) * Math.sqrt(repoCount) * Math.log2(p.commits + 1);
      return {
        login: p.login,
        name: p.name,
        commits: p.commits,
        aiCommits: p.aiCommits,
        aiShare,
        repos: repoCount,
        repoNames,
        lastActiveAt: p.last ? p.last.toISOString() : null,
        championScore: Math.round(championScore * 100) / 100,
      };
    })
    .sort((a, b) => b.commits - a.commits);

  const concentration: RepoConcentration[] = [...repos.entries()]
    .map(([fullName, { name, entries }]) => {
      const sorted = [...entries].sort((a, b) => b.commits - a.commits);
      const total = sorted.reduce((s, e) => s + e.commits, 0);
      let acc = 0;
      let busFactor = 0;
      for (const e of sorted) {
        acc += e.commits;
        busFactor += 1;
        if (acc > total / 2) break;
      }
      const topShare = total ? Math.round(((sorted[0]?.commits ?? 0) / total) * 100) : 0;
      return {
        fullName,
        name,
        contributorCount: sorted.length,
        totalCommits: total,
        topLogin: sorted[0]?.login ?? "—",
        topShare,
        busFactor,
        soloMaintainer: sorted.length === 1 || topShare >= 80,
      };
    })
    .sort((a, b) => b.topShare - a.topShare);

  const totalCommits = contributors.reduce((s, c) => s + c.commits, 0);
  const aiCommitsTotal = contributors.reduce((s, c) => s + c.aiCommits, 0);
  const aiActive = contributors.filter((c) => c.aiCommits > 0).length;
  const champions = [...contributors]
    .filter((c) => c.commits >= 3 && c.aiCommits > 0)
    .sort((a, b) => b.championScore - a.championScore)
    .slice(0, 6);

  return {
    org: orgSlug,
    totalContributors: contributors.length,
    aiActive,
    aiActiveShare: contributors.length ? Math.round((aiActive / contributors.length) * 100) : 0,
    orgAiShare: totalCommits ? Math.round((aiCommitsTotal / totalCommits) * 100) : 0,
    soloMaintainerCount: concentration.filter((r) => r.soloMaintainer).length,
    contributors,
    champions,
    concentration,
  };
}
