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
  /** Delivery signals shown as CONTEXT next to adoption (no causal claim). Null when no PR data. */
  delivery: { typicalHoursToMerge: number | null; reviewedRate: number | null; mergeRate: number; aiInvolvedRate: number; prs: number } | null;
  knowledgeLeader: { name: string; aiCommitShare: number } | null;
}

export async function buildAdoptionOverview(orgSlug: string): Promise<AdoptionOverview | null> {
  const [insights, pr, teams] = await Promise.all([
    getContributorInsights(orgSlug),
    getOrgPrSignals(orgSlug),
    getOrgTeamRollup(orgSlug),
  ]);
  if (!insights || insights.totalContributors === 0) return null;

  const distribution = { high: 0, some: 0, none: 0 };
  for (const c of insights.contributors) {
    if (c.aiShare >= 50) distribution.high += 1;
    else if (c.aiShare > 0) distribution.some += 1;
    else distribution.none += 1;
  }

  return {
    org: orgSlug,
    generatedOn: new Date().toISOString().slice(0, 10),
    contributors: { total: insights.totalContributors, aiActive: insights.aiActive, aiActiveShare: insights.aiActiveShare },
    orgAiShare: insights.orgAiShare,
    distribution,
    champions: insights.champions.slice(0, 6).map((c) => ({ login: c.login, aiShare: c.aiShare, commits: c.commits, aiCommits: c.aiCommits })),
    delivery: pr
      ? { typicalHoursToMerge: pr.typicalHoursToMerge, reviewedRate: pr.avgReviewedRate, mergeRate: pr.avgMergeRate, aiInvolvedRate: pr.avgAiInvolvedRate, prs: pr.totalPrs }
      : null,
    knowledgeLeader: teams?.knowledgeLeader ? { name: teams.knowledgeLeader.name, aiCommitShare: teams.knowledgeLeader.aiCommitShare } : null,
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
  if (a.knowledgeLeader) out.push(`- Most AI-attributed team: ${a.knowledgeLeader.name} (${a.knowledgeLeader.aiCommitShare}% AI commit share)`);
  if (a.delivery) {
    out.push("");
    out.push("## Delivery (context — not a causal claim)");
    const d = a.delivery;
    out.push(
      `- ${d.typicalHoursToMerge != null ? `${d.typicalHoursToMerge}h typical PR merge time · ` : ""}${d.reviewedRate != null ? `${d.reviewedRate}% reviewed · ` : ""}${d.mergeRate}% merged · ${d.aiInvolvedRate}% AI-involved PRs (${d.prs} PRs)`,
    );
  }
  out.push("");
  out.push("## AI champions");
  for (const c of a.champions) out.push(`- ${c.login}: ${c.aiShare}% AI (${c.aiCommits}/${c.commits} commits)`);
  out.push("");
  out.push("## Ask");
  out.push(
    "Given this AI-adoption and delivery snapshot, propose the 3 highest-leverage moves to (a) raise AI adoption among the contributors and teams with low AI share, and (b) convert that adoption into faster, well-reviewed delivery. For each: who or which team, the concrete enablement, and the delivery metric it should improve.",
  );
  return out.join("\n");
}
