// Contributor aggregates across an org's repos — the "who is AI-native" view and contributor
// intelligence (F5). All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { aiShareOf, isBot, pickChampions, segmentScope, techGroupScope } from "@/lib/db/org-shared";
import { getOrgId } from "@/lib/db/org-rollup";
import {
  CHAMPION_LIMIT,
  MIN_CHAMPION_COMMITS,
  TOP_CONTRIBUTOR_PLACEHOLDER,
  canNameIndividuals,
  type TopContributorState,
} from "@/components/org/shared/champions";

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
  /** The top contributor's login when — and ONLY when — `topLoginState` is `"named"`. In the other
   *  two states this is the neutral `TOP_CONTRIBUTOR_PLACEHOLDER`; read `topLoginState` (or
   *  `topContributorLabel`) to say WHY, never this string. */
  topLogin: string;
  /** Whether `topLogin` is a name, a withheld name, or nobody — see `TopContributorState`. This is
   *  the field that makes the privacy floor verifiable from the payload: `"withheld"` proves the
   *  producer suppressed an identity here, which a bare "—" could never distinguish from "no data". */
  topLoginState: TopContributorState;
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
  /** Per repo, sorted by topShare desc. EVERY repo is present at every population size — counts,
   *  shares and bus factors are aggregates and are never dropped (a two-person org is the most
   *  key-person-exposed org there is; withholding its rows would hide the finding, not the person).
   *  Only the identity is suppressed: below the floor `topLogin` becomes the placeholder and
   *  `topLoginState` becomes `"withheld"`. */
  concentration: RepoConcentration[];
  /** Fleet key-person exposure rolled up from `concentration` (G7-18). Names NO individual at any
   *  population size — see the note above `computeOrgResilience`. Null when no repo has commit data. */
  resilience: OrgResilience | null;
}

/** Fold one concentration row into its withheld form: the identity goes, every number stays. */
function withholdTopContributor(row: RepoConcentration): RepoConcentration {
  // A row with nobody to name stays `"unknown"` — calling it "withheld" would claim a suppression
  // that never happened, which is the same class of lie this state exists to end.
  if (row.topLoginState !== "named") return row;
  return { ...row, topLogin: TOP_CONTRIBUTOR_PLACEHOLDER, topLoginState: "withheld" };
}

// ── ORG RESILIENCE (G7-18) ───────────────────────────────────────────────────
//
// Bus factor and commit concentration were already computed, but only as two columns in a passive
// per-repo table — a board-relevant risk that required someone to notice a number. This rolls them
// into a fleet read: how exposed is the org to any one person leaving, which repos carry that
// exposure, and how much of the fleet's actual work sits behind it.
//
// WHERE THE PRIVACY LINE IS DRAWN, and why it is drawn TIGHTER than the rest of this module.
// "Key-person risk" is the one metric on the dashboard whose natural phrasing is a claim about a
// named human ("the bus factor here is Dana"). Everything below is deliberately a claim about a
// REPOSITORY instead: it has one point of failure, N contributors, X% concentration. That statement
// carries the entire decision value — you fix it by pairing, rotating ownership, or writing the repo
// down, none of which needs the name — while a name adds only the ability to point at someone in a
// leadership review as a liability. So `OrgResilience` carries NO login field at all, at ANY
// population size. That is stricter than `concentration` above (which does surface `topLogin` when
// the population clears the naming floor) and stricter than it strictly has to be; the asymmetry is
// intentional, because a "Risk" framing is exactly where a name stops being descriptive and starts
// being an accusation. The existing concentration table remains the one place a name appears, under
// the existing floor, where it reads as attribution rather than exposure.

/** One repo's key-person exposure. Deliberately carries NO contributor login — see the note above. */
export interface RepoResilienceRisk {
  fullName: string;
  name: string;
  contributorCount: number;
  busFactor: number;
  topShare: number;
  totalCommits: number;
  /** 0..100 — higher means more concentrated, i.e. more exposed to one person leaving. */
  riskScore: number;
  band: "critical" | "high" | "moderate" | "low";
}

export interface OrgResilience {
  /** 0..100, commit-WEIGHTED across repos — higher is more resilient. Weighted so a dormant toy repo
   *  with one author doesn't drag down (or a busy well-spread repo doesn't mask) the fleet read. */
  score: number;
  repos: number;
  /** Repos in the critical band (effectively single-author). */
  critical: number;
  /** Repos in the critical OR high band — the ones worth acting on. */
  atRisk: number;
  /** 0..100 — share of the fleet's commits that live in at-risk repos. The number that says whether
   *  the exposure is on the work that matters or on the archive. */
  exposedCommitShare: number;
  /** Riskiest repos, worst first, capped. No individuals named. */
  topRisks: RepoResilienceRisk[];
}

/** How many repos the risk list shows before it stops being a list and starts being the table again. */
const RESILIENCE_LIST_CAP = 8;

function resilienceBand(risk: number): RepoResilienceRisk["band"] {
  if (risk >= 80) return "critical";
  if (risk >= 60) return "high";
  if (risk >= 40) return "moderate";
  return "low";
}

/**
 * Fold per-repo concentration into a fleet resilience read. PURE — takes the already-computed
 * concentration rows, so it is unit-testable without a DB and cannot see (let alone emit) a login.
 *
 * The per-repo risk blends the two facts that are already measured, because either alone lies: top
 * share alone calls a 2-author 60/40 repo healthy, and bus factor alone calls a 51/49 repo as safe as
 * a 20-author one. 60% concentration + 40% inverse bus factor (1 → 100, 2 → 50, 3 → 33…).
 * Returns null for an org with no repo-level commit data — nothing to be resilient about.
 */
export function computeOrgResilience(concentration: readonly RepoConcentration[]): OrgResilience | null {
  if (!concentration.length) return null;

  const rows: RepoResilienceRisk[] = concentration.map((r) => {
    const riskScore = Math.round(0.6 * r.topShare + 0.4 * (100 / Math.max(1, r.busFactor)));
    return {
      fullName: r.fullName,
      name: r.name,
      contributorCount: r.contributorCount,
      busFactor: r.busFactor,
      topShare: r.topShare,
      totalCommits: r.totalCommits,
      riskScore,
      band: resilienceBand(riskScore),
    };
  });

  const totalCommits = rows.reduce((s, r) => s + r.totalCommits, 0);
  // Weight by commits where there are any; fall back to an unweighted mean so a fleet whose snapshots
  // carry zero commits still gets a real (if flat-weighted) score instead of a divide-by-zero NaN.
  const weighted = totalCommits > 0
    ? rows.reduce((s, r) => s + r.riskScore * r.totalCommits, 0) / totalCommits
    : rows.reduce((s, r) => s + r.riskScore, 0) / rows.length;
  const atRiskRows = rows.filter((r) => r.band === "critical" || r.band === "high");

  return {
    score: Math.max(0, Math.min(100, Math.round(100 - weighted))),
    repos: rows.length,
    critical: rows.filter((r) => r.band === "critical").length,
    atRisk: atRiskRows.length,
    exposedCommitShare: totalCommits > 0
      ? Math.round((atRiskRows.reduce((s, r) => s + r.totalCommits, 0) / totalCommits) * 100)
      : 0,
    topRisks: [...rows]
      .sort((a, b) => b.riskScore - a.riskScore || b.totalCommits - a.totalCommits || a.fullName.localeCompare(b.fullName))
      .slice(0, RESILIENCE_LIST_CAP),
  };
}

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
    .map(([fullName, { name, entries }]): RepoConcentration => {
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
        topLogin: sorted[0]?.login ?? TOP_CONTRIBUTOR_PLACEHOLDER,
        topLoginState: sorted[0] ? "named" : "unknown",
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
    // The per-repo top contributor is a named individual too — withhold the NAME below the floor
    // while keeping every row and every number the key-person-risk view is actually built on. The
    // withheld state is typed (`topLoginState`), not just a blanked string, so a consumer can render
    // "name withheld — population below the naming floor" instead of the "—" it shows for no data.
    concentration: namingAllowed ? concentration : concentration.map(withholdTopContributor),
    // Computed from the concentration rows, which are population-independent aggregates — so the
    // resilience read survives the naming floor intact (that is the point: a 2-person org is the MOST
    // key-person-exposed org there is, and withholding its risk read would hide the finding, not a
    // person). It emits no login either way.
    resilience: computeOrgResilience(concentration),
  };
}
