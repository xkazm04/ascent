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

/**
 * Someone to INVITE to the next enablement session: an active contributor whose recent work carries no
 * AI attribution yet. Read it as an invitation list, not a shortfall list — "not measured using AI"
 * is not a performance finding, and the row exists to answer "who would get the most out of a seat in
 * the room", never "who is behind". The copy every surface renders is held to that (see
 * `enablementTargets` and the brief's section below).
 */
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
  /** Who to INVITE to enablement next: active contributors with no AI-attributed commits yet. */
  enablement: EnablementTarget[];
}

/** Minimum AI-share gap (pts) between the top and bottom team before suggesting a pairing. */
export const PAIRING_MIN_GAP = 15;
/** Minimum commit volume before an invitation is meaningful — below it, "no AI commits yet" is more
 *  likely a quiet month than an unmet interest, and an invitation on that basis reads as a summons. */
const ENABLEMENT_MIN_COMMITS = 3;
const ENABLEMENT_LIMIT = 8;
const TOOLS_LIMIT = 10;

/**
 * The enablement INVITATION list: contributors carrying real recent volume whose commits show no AI
 * attribution yet — the people most likely to get something out of the next enablement session.
 *
 * FRAMING, which is load-bearing and not decoration. The same rows can be phrased two ways: "who is
 * behind on AI adoption" (a shortfall list about people, which invites a manager to use it as one)
 * or "who to invite next" (an offer they can accept or ignore). This module commits to the second
 * everywhere the rows are named — the type, the field, and the brief's section heading and prose —
 * because the measurement is a proxy: no AI-attributed commits can equally mean not interested, not
 * needed for this work, or using a tool we cannot attribute. A proxy that weak can support an
 * invitation; it cannot support a judgement. The suppression floor below protects the person; the
 * wording protects the meaning, and the two are the same guarantee.
 *
 * Exported because TWO surfaces need it and the cohort must be defined once. The adoption brief
 * (adoptionMarkdown, via buildAdoptionOverview) still carries it into the LLM prompt, while the
 * on-screen "Who to enable next" table moved to the Contributors tab (2026-08-19), which already has
 * `getContributorInsights` in hand and must not run a whole second buildAdoptionOverview to read a
 * list it can derive. Duplicating the two thresholds at the second call site is exactly what let
 * three adoption surfaces drift apart before.
 *
 * `namingAllowed` is the CHAMPION_MIN_POP privacy guard. Below the floor, naming 1–2 identifiable
 * people is a surveillance-y ranking, so the cohort is empty and every caller inherits the
 * suppression — which is also why an empty list IS the render guard; no call site re-checks the
 * population.
 *
 * Pure. Takes the narrow slice of ContributorInsights it reads, so a caller can pass either producer's
 * result. `contributors` arrives sorted by commits desc, so filter order = volume order = leverage order.
 */
export function enablementTargets(insights: {
  namingAllowed: boolean;
  contributors: { login: string; name: string | null; aiShare: number; commits: number; repos: number; lastActiveAt: string | null }[];
}): EnablementTarget[] {
  if (!insights.namingAllowed) return [];
  return insights.contributors
    .filter((c) => c.aiShare === 0 && c.commits >= ENABLEMENT_MIN_COMMITS)
    .slice(0, ENABLEMENT_LIMIT)
    .map((c) => ({ login: c.login, name: c.name, commits: c.commits, repos: c.repos, lastActiveAt: c.lastActiveAt }));
}

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

  // The AI-share spread is an AGGREGATE, so it comes from getContributorInsights directly rather than
  // being recomputed by walking the per-person rows — which the producer withholds below the privacy
  // floor (G4-03). Deriving it here from `contributors` would have silently zeroed the spread for
  // small orgs the moment the producer started suppressing rows.
  const distribution = insights.distribution;

  // CHAMPION_MIN_POP privacy guard. It is now enforced by getContributorInsights / rollupTeams
  // themselves (champions, per-person rows and the team knowledge leader all arrive already
  // suppressed), so this flag only decides whether THIS builder names people in the lists it derives
  // itself. Below the floor, naming 1–2 identifiable people is a surveillance-y ranking, and
  // adoptionMarkdown would carry it into an LLM prompt.
  const namingAllowed = insights.namingAllowed;

  // The invitation list, through the shared helper (see enablementTargets — it applies the same
  // `namingAllowed` guard internally). Still built here because adoptionMarkdown puts it in the LLM
  // brief's enablement ASK; the on-screen table now lives on the Contributors tab.
  const enablement = enablementTargets(insights);

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
    champions: !namingAllowed
      ? []
      : insights.champions
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
    out.push("## Delivery (context, not a causal claim)");
    const d = a.delivery;
    out.push(
      `- ${d.typicalHoursToMerge != null ? `${d.typicalHoursToMerge}h typical PR merge time · ` : ""}${d.reviewedRate != null ? `${d.reviewedRate}% reviewed · ` : ""}${d.mergeRate}% merged · ${d.aiInvolvedRate}% AI-involved PRs (${d.prs} PRs)${d.aiGovernedRate != null ? ` · ${d.aiGovernedRate}% of AI PRs human-reviewed` : ""}`,
    );
  }
  // Named-individual sections mirror the page's CHAMPION_MIN_POP guard: when the builder withheld
  // the lists (small population), the brief must not carry an empty header implying suppression is a
  // data gap — it simply omits the sections, exactly like the page.
  if (a.champions.length) {
    out.push("");
    out.push("## AI champions");
    for (const c of a.champions) out.push(`- ${c.login}: ${c.aiShare}% AI (${c.aiCommits}/${c.commits} commits across ${c.repos} repos)`);
  }
  if (a.enablement.length) {
    out.push("");
    // Invitation framing, in the one place it matters most: this text is pasted into an LLM prompt and
    // comes back as a leadership-facing plan. "Enablement cohort" reads to a model as a deficiency
    // list and it will write remediation copy about named people. Naming it as an offer, and saying
    // out loud that the signal is a proxy rather than a verdict, changes what comes back.
    out.push("## Who to invite to enablement next (an offer, not a shortfall list)");
    for (const e of a.enablement) out.push(`- ${e.login}: ${e.commits} commits across ${e.repos} repos`);
    out.push(
      `- ${a.distribution.none} contributors show no AI-attributed commits yet; the ones above are simply the most active, so an invitation reaches them where they are already working.`,
    );
    out.push(
      "- No AI-attributed commits is not a performance signal: it can mean not interested, not applicable to this work, or a tool we cannot attribute. Treat these as people to invite and support, never as people to correct.",
    );
  }
  out.push("");
  out.push("## Ask");
  out.push(
    "Given this AI-adoption and delivery snapshot, propose the 3 highest-leverage moves to (a) make AI enablement easy to opt into for the contributors and teams with low AI share, and (b) convert that adoption into faster, well-reviewed delivery. For each: who or which team to invite, the concrete support on offer, and the delivery metric it should improve. Frame every move as an invitation or an offer of support — never as corrective action against a named individual.",
  );
  return out.join("\n");
}
