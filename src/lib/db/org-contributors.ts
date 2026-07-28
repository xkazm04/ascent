// Contributor aggregates across an org's repos — the "who is AI-native" view and contributor
// intelligence (F5). All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { aiShareOf, isBot, pickChampions, segmentScope, techGroupScope } from "@/lib/db/org-shared";
import { getOrgId } from "@/lib/db/org-rollup";
import { CHAMPION_LIMIT, MIN_CHAMPION_COMMITS, canNameIndividuals } from "@/components/org/shared/champions";

// ── Contributor intelligence (F5) ────────────────────────────────────────────
// All derived from the stored RepoContributor snapshots (latest scan per repo) — no extra
// GitHub calls. "commits"/"aiCommits" reflect the recent-activity window we capture at scan
// time. Bots ([bot]) and unattributed ("unknown") commits are excluded from the human view.
//
// Heterogeneous-recency guard (ambiguity-ui 2026-07-16 #5): each repo's snapshot is anchored to
// that repo's OWN last scan, so on a mixed-cadence fleet a repo last scanned a year ago would
// otherwise inject its stale activity into orgAiShare / champions / busFactor with the same weight
// as yesterday's snapshot — an engineer who left could stay the org's "#1 AI champion" via one
// unscanned repo. Mirroring org-signals' ACTIVITY_HORIZON_WEEKS fix, repos whose snapshot recency
// (their newest contributor lastActiveAt — captured at scan time, so a proxy for scan freshness)
// trails the fleet's newest by more than the horizon are DROPPED from the human aggregates, and the
// count is exposed as `staleRepos` so the UI can annotate. Repos with no lastActiveAt data at all
// are kept — their recency is unknown, not provably stale.
const CONTRIBUTOR_HORIZON_MS = 26 * 7 * 86_400_000; // ~6 months, same "recent" bar as org-signals

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
  /** Repos excluded from these aggregates because their snapshot recency trails the fleet's newest
   *  by more than the ~6-month horizon (see the heterogeneous-recency guard above). Lets the UI
   *  annotate "N stale repos excluded" instead of silently blending mixed-age windows. */
  staleRepos: number;
  /** Contributors bucketed by personal AI share: high (≥50%), some (1–49%), none (0%). An AGGREGATE —
   *  always populated, even below the naming floor, so a small org still gets an adoption spread
   *  without any consumer having to walk the (withheld) per-person rows to compute it. */
  distribution: { high: number; some: number; none: number };
  /** False when fewer than CHAMPION_MIN_POP humans are in scope. This producer then withholds EVERY
   *  per-individual field it emits (see below) — the privacy floor is enforced here, not at the call
   *  sites, so a new consumer (CSV export, PDF brief, digest, OG image) inherits it by construction.
   *  Consumers use this only to pick honest copy ("withheld", not "no data"). */
  namingAllowed: boolean;
  /** All humans, sorted by commits desc — EMPTY when `namingAllowed` is false. */
  contributors: ContributorInsight[];
  /** Top by championScore — EMPTY when `namingAllowed` is false. */
  champions: ContributorInsight[];
  /** Per repo, sorted by topShare desc. Counts/shares are aggregates and always present; `topLogin`
   *  is a named individual and is redacted to "—" when `namingAllowed` is false. */
  concentration: RepoConcentration[];
}

/** What `topLogin` reads when the population is below the naming floor (same sentinel as "no data"). */
const REDACTED_LOGIN = "—";

/** Contributor involvement, AI-native profiles, champions, and bus-factor across an org. */
export async function getContributorInsights(orgSlug: string, segmentId?: string | null, techGroupId?: string | null): Promise<ContributorInsights | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;

  const rows = await prisma.repoContributor.findMany({
    where: { repo: { orgId, ...segmentScope(segmentId), ...techGroupScope(techGroupId) } },
    select: {
      login: true,
      name: true,
      commits: true,
      aiCommits: true,
      lastActiveAt: true,
      repo: { select: { fullName: true, name: true } },
    },
  });

  // Heterogeneous-recency guard: drop repos whose snapshot recency trails the fleet's newest by
  // more than the horizon (see module header). Recency proxy = the repo's newest contributor
  // lastActiveAt, captured at scan time; repos with none are kept (unknown ≠ provably stale).
  const repoNewest = new Map<string, number>();
  for (const r of rows) {
    const t = r.lastActiveAt?.getTime();
    if (t == null || Number.isNaN(t)) continue;
    const cur = repoNewest.get(r.repo.fullName);
    if (cur == null || t > cur) repoNewest.set(r.repo.fullName, t);
  }
  const anchor = repoNewest.size ? Math.max(...repoNewest.values()) : null;
  const staleRepoNames = new Set<string>();
  if (anchor != null) {
    for (const [fullName, newest] of repoNewest) {
      if (anchor - newest > CONTRIBUTOR_HORIZON_MS) staleRepoNames.add(fullName);
    }
  }
  const freshRows = rows.filter((r) => !staleRepoNames.has(r.repo.fullName));

  // Per-contributor aggregation (humans only).
  const people = new Map<
    string,
    { login: string; name: string | null; commits: number; aiCommits: number; repos: Map<string, number>; last: Date | null }
  >();
  // Per-repo contributor lists (humans only) for concentration / bus factor.
  const repos = new Map<string, { name: string; entries: { login: string; commits: number }[] }>();

  for (const r of freshRows) {
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
      const aiShare = aiShareOf(p.commits, p.aiCommits);
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

  // Aggregate spread — computed over EVERY human, so it survives the naming floor below.
  const distribution = { high: 0, some: 0, none: 0 };
  for (const c of contributors) {
    if (c.aiShare >= 50) distribution.high += 1;
    else if (c.aiShare > 0) distribution.some += 1;
    else distribution.none += 1;
  }

  // PRIVACY FLOOR, enforced in the producer (G4-01/G4-03). Below CHAMPION_MIN_POP humans, every
  // per-individual field is withheld here: a 1–2 person org's sole AI user was otherwise crowned a
  // celebrated "#1 ★ champion", listed by name in the involvement table, and shipped as per-person
  // rows in the CSV — a surveillance-y ranking of identifiable people, not an adoption signal. The
  // guard used to live only in the React layer, so every new consumer had to remember it (the CSV
  // export and the Adoption brief both forgot). Aggregates (totals, shares, distribution, bus
  // factor) are unaffected — the fallback is aggregation-only, not "no data".
  const namingAllowed = canNameIndividuals(contributors.length);
  // Eligibility + cap live next to CHAMPION_MIN_POP in champions.ts, with their rationale — who
  // gets publicly named here is a deliberate, documented choice, not a magic number.
  const champions = namingAllowed
    ? pickChampions(contributors, {
        filter: (c) => c.commits >= MIN_CHAMPION_COMMITS && c.aiCommits > 0,
        by: (c) => c.championScore,
        limit: CHAMPION_LIMIT,
      })
    : [];

  return {
    org: orgSlug,
    totalContributors: contributors.length,
    aiActive,
    aiActiveShare: contributors.length ? Math.round((aiActive / contributors.length) * 100) : 0,
    orgAiShare: totalCommits ? Math.round((aiCommitsTotal / totalCommits) * 100) : 0,
    soloMaintainerCount: concentration.filter((r) => r.soloMaintainer).length,
    staleRepos: staleRepoNames.size,
    distribution,
    namingAllowed,
    contributors: namingAllowed ? contributors : [],
    champions,
    // The per-repo top contributor is a named individual too — redact it below the floor while
    // keeping the concentration/bus-factor numbers the key-person-risk view is actually built on.
    concentration: namingAllowed ? concentration : concentration.map((r) => ({ ...r, topLogin: REDACTED_LOGIN })),
  };
}
