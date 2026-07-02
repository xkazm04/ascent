// AI-adoption intelligence (Direction #1 phase 1) — the "people analytics" view: how much of the org's
// work is AI-assisted, who the champions are, and the delivery health it sits alongside. Pure assembly
// over existing aggregates (contributor AI-attribution + PR signals + team rollup); NO new commit-history
// ingestion (that's a later phase). Delivery is shown ALONGSIDE adoption as honest context — not a
// fabricated causal ROI. Powers /org/[slug]/adoption + its Copy-for-LLM brief.

import { getContributorInsights, getOrgPrSignals, getOrgTeamRollup } from "@/lib/db";

export interface AdoptionChampion {
  login: string;
  aiShare: number; // 0..100 of this person's commits that are AI-attributed
  commits: number;
  aiCommits: number;
  repos: number; // breadth — distinct repos this person touched
}

/** Per-team AI adoption (CODEOWNERS attribution) — the "which team to pair with which" layer. */
export interface AdoptionTeam {
  slug: string; // "@org/team"
  name: string;
  aiCommitShare: number; // 0..100, commit-weighted across the team's repos
  contributors: number;
  aiContributors: number;
  repoCount: number;
}

/** A high-volume contributor with no AI-attributed commits yet — the enablement leverage point. */
export interface EnablementTarget {
  login: string;
  name: string | null;
  commits: number;
  repos: number;
  lastActiveAt: string | null;
}

export interface AdoptionOverview {
  org: string;
  generatedOn: string;
  contributors: { total: number; aiActive: number; aiActiveShare: number };
  /** Commit-weighted share of all human commits that are AI-attributed (0..100). */
  orgAiShare: number;
  /** Contributors bucketed by personal AI share: heavy (>=50%), partial (1–49%), none (0%). */
  distribution: { high: number; some: number; none: number };
  champions: AdoptionChampion[]; // top culture carriers by championScore
  /** Delivery signals shown as CONTEXT next to adoption (no causal claim). Null when no PR data.
   *  aiGovernedRate = share of AI-involved PRs that got a human review — the governance half. */
  delivery: {
    typicalHoursToMerge: number | null;
    reviewedRate: number | null;
    mergeRate: number;
    aiInvolvedRate: number;
    aiGovernedRate: number | null;
    prs: number;
  } | null;
  knowledgeLeader: { name: string; aiCommitShare: number } | null;
  /** AI tools detected across the fleet's PRs (co-authorship/body markers), most-used first. */
  tools: { name: string; count: number }[];
  /** Per-team adoption, highest AI commit share first. Empty when no CODEOWNERS attribution. */
  teams: AdoptionTeam[];
  /** The single highest-leverage mentor→learner team pairing on AI share (gap ≥ PAIRING_MIN_GAP). */
  teamPairing: { leader: AdoptionTeam; learner: AdoptionTeam; gap: number } | null;
  /** Zero-AI contributors with the most recent volume — where enablement moves the org number fastest. */
  enablement: EnablementTarget[];
}

/** Minimum AI-share gap (pts) between the top and bottom team before suggesting a pairing. */
export const PAIRING_MIN_GAP = 15;
/** Minimum commit volume before a zero-AI contributor is a meaningful enablement target. */
const ENABLEMENT_MIN_COMMITS = 3;
const ENABLEMENT_LIMIT = 8;
const TOOLS_LIMIT = 10;

export async function buildAdoptionOverview(
  orgSlug: string,
  segmentId?: string | null,
  techGroupId?: string | null,
): Promise<AdoptionOverview | null> {
  const [insights, pr, teams] = await Promise.all([
    getContributorInsights(orgSlug, segmentId, techGroupId),
    getOrgPrSignals(orgSlug, segmentId, techGroupId),
    getOrgTeamRollup(orgSlug, segmentId, techGroupId),
  ]);
  if (!insights || insights.totalContributors === 0) return null;

  const distribution = { high: 0, some: 0, none: 0 };
  for (const c of insights.contributors) {
    if (c.aiShare >= 50) distribution.high += 1;
    else if (c.aiShare > 0) distribution.some += 1;
    else distribution.none += 1;
  }

  // insights.contributors is sorted by commits desc, so filter order = volume order (leverage order).
  const enablement: EnablementTarget[] = insights.contributors
    .filter((c) => c.aiShare === 0 && c.commits >= ENABLEMENT_MIN_COMMITS)
    .slice(0, ENABLEMENT_LIMIT)
    .map((c) => ({ login: c.login, name: c.name, commits: c.commits, repos: c.repos, lastActiveAt: c.lastActiveAt }));

  const adoptionTeams: AdoptionTeam[] = (teams?.teams ?? [])
    .map((t) => ({
      slug: t.slug,
      name: t.name,
      aiCommitShare: t.aiCommitShare,
      contributors: t.contributors,
      aiContributors: t.aiContributors,
      repoCount: t.repoCount,
    }))
    .sort((a, b) => b.aiCommitShare - a.aiCommitShare);

  // Mentor→learner pairing on AI share: top team vs the lowest team that has people to enable.
  let teamPairing: AdoptionOverview["teamPairing"] = null;
  if (adoptionTeams.length >= 2) {
    const leader = adoptionTeams[0]!;
    const learner = [...adoptionTeams].reverse().find((t) => t !== leader && t.contributors > 0);
    if (learner) {
      const gap = leader.aiCommitShare - learner.aiCommitShare;
      if (gap >= PAIRING_MIN_GAP) teamPairing = { leader, learner, gap };
    }
  }

  return {
    org: orgSlug,
    generatedOn: new Date().toISOString().slice(0, 10),
    contributors: { total: insights.totalContributors, aiActive: insights.aiActive, aiActiveShare: insights.aiActiveShare },
    orgAiShare: insights.orgAiShare,
    distribution,
    champions: insights.champions
      .slice(0, 6)
      .map((c) => ({ login: c.login, aiShare: c.aiShare, commits: c.commits, aiCommits: c.aiCommits, repos: c.repos })),
    delivery: pr
      ? {
          typicalHoursToMerge: pr.typicalHoursToMerge,
          reviewedRate: pr.avgReviewedRate,
          mergeRate: pr.avgMergeRate,
          aiInvolvedRate: pr.avgAiInvolvedRate,
          aiGovernedRate: pr.avgAiGovernedRate ?? null,
          prs: pr.totalPrs,
        }
      : null,
    knowledgeLeader: teams?.knowledgeLeader ? { name: teams.knowledgeLeader.name, aiCommitShare: teams.knowledgeLeader.aiCommitShare } : null,
    tools: (pr?.tools ?? []).slice(0, TOOLS_LIMIT),
    teams: adoptionTeams,
    teamPairing,
    enablement,
  };
}

/** A markdown brief for the "Copy for LLM" action — adoption + delivery context + an enablement ASK. */
export function adoptionMarkdown(a: AdoptionOverview): string {
  const out: string[] = [];
  out.push(`# AI adoption: ${a.org}`);
  out.push(`Generated ${a.generatedOn}`);
  out.push("");
  out.push("## AI adoption");
  out.push(`- Org AI commit share: ${a.orgAiShare}% (commit-weighted across contributors)`);
  out.push(`- AI-active contributors: ${a.contributors.aiActive}/${a.contributors.total} (${a.contributors.aiActiveShare}%)`);
  out.push(`- Spread: ${a.distribution.high} heavy (>=50% AI) · ${a.distribution.some} partial · ${a.distribution.none} none`);
  if (a.tools.length) out.push(`- AI tooling detected in PRs: ${a.tools.map((t) => `${t.name} ×${t.count}`).join(", ")}`);
  if (a.knowledgeLeader) out.push(`- Most AI-attributed team: ${a.knowledgeLeader.name} (${a.knowledgeLeader.aiCommitShare}% AI commit share)`);
  if (a.teams.length) {
    out.push("");
    out.push("## Team adoption (CODEOWNERS)");
    for (const t of a.teams) {
      out.push(`- ${t.name}: ${t.aiCommitShare}% AI commit share · ${t.aiContributors}/${t.contributors} contributors AI-active · ${t.repoCount} repos`);
    }
    if (a.teamPairing) {
      out.push(
        `- Suggested pairing: ${a.teamPairing.leader.name} (${a.teamPairing.leader.aiCommitShare}%) mentors ${a.teamPairing.learner.name} (${a.teamPairing.learner.aiCommitShare}%)`,
      );
    }
  }
  if (a.delivery) {
    out.push("");
    out.push("## Delivery (context — not a causal claim)");
    const d = a.delivery;
    out.push(
      `- ${d.typicalHoursToMerge != null ? `${d.typicalHoursToMerge}h typical PR merge time · ` : ""}${d.reviewedRate != null ? `${d.reviewedRate}% reviewed · ` : ""}${d.mergeRate}% merged · ${d.aiInvolvedRate}% AI-involved PRs (${d.prs} PRs)${d.aiGovernedRate != null ? ` · ${d.aiGovernedRate}% of AI PRs human-reviewed` : ""}`,
    );
  }
  out.push("");
  out.push("## AI champions");
  for (const c of a.champions) out.push(`- ${c.login}: ${c.aiShare}% AI (${c.aiCommits}/${c.commits} commits across ${c.repos} repos)`);
  if (a.enablement.length) {
    out.push("");
    out.push("## Enablement cohort (no AI-attributed commits yet)");
    for (const e of a.enablement) out.push(`- ${e.login}: ${e.commits} commits across ${e.repos} repos`);
    out.push(
      `- ${a.distribution.none} contributors total show no AI-attributed commits; the ones above carry the most recent volume.`,
    );
  }
  out.push("");
  out.push("## Ask");
  out.push(
    "Given this AI-adoption and delivery snapshot, propose the 3 highest-leverage moves to (a) raise AI adoption among the contributors and teams with low AI share, and (b) convert that adoption into faster, well-reviewed delivery. For each: who or which team, the concrete enablement, and the delivery metric it should improve.",
  );
  return out.join("\n");
}
