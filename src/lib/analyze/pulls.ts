// Pull-request signal extraction. Turns a page of raw PR nodes into a PrStats summary that
// captures *how much* AI is involved and *how systematically* the team works around it
// (review coverage, PR size, velocity, agent authorship). Feeds the report + org dashboard
// now, and the maturity score in F4.

import { fetchPullRequests, type PrNode } from "@/lib/github/graphql";
import { clamp } from "@/lib/maturity/model";
import type { DimensionSignals, Governance, PrStats } from "@/lib/types";

// AI coding agents that open PRs as GitHub App bots (author.__typename === "Bot").
const AI_AGENT = /(copilot|devin|cursor|codex|sweep|claude|aider)/i;
// AI fingerprints in PR title / body / labels (human-authored but AI-assisted).
const AI_MARKER =
  /(co-authored-by:\s*(claude|copilot|cursor|devin|gemini|aider|codex)|generated with (claude|copilot|cursor|codex)|🤖|claude code|github copilot|made with cursor)/i;
const AI_TOOLS: { name: string; re: RegExp }[] = [
  { name: "Claude", re: /claude/i },
  { name: "Copilot", re: /copilot/i },
  { name: "Cursor", re: /cursor/i },
  { name: "Devin", re: /devin/i },
  { name: "Codex", re: /codex/i },
  { name: "Gemini", re: /gemini/i },
  { name: "Aider", re: /aider/i },
];

function median(xs: number[]): number | null {
  // Drop any non-finite entries first: a single malformed timestamp upstream would otherwise
  // make the comparator return NaN (unstable sort) and can yield a NaN median.
  const finite = xs.filter((x) => Number.isFinite(x));
  if (!finite.length) return null;
  const s = finite.sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(v * 10) / 10;
}
// Returns null when either timestamp is missing/malformed, so a bad GraphQL date can't poison the
// velocity medians (a NaN that JSON.stringify would serialize as null further downstream).
const hoursBetween = (later: string, earlier: string): number | null => {
  const l = new Date(later).getTime();
  const e = new Date(earlier).getTime();
  if (!Number.isFinite(l) || !Number.isFinite(e)) return null;
  return Math.max(0, (l - e) / 3_600_000);
};
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export function summarizePullRequests(nodes: PrNode[], totalCount: number): PrStats {
  const analyzed = nodes.length;
  let open = 0,
    merged = 0,
    closedUnmerged = 0,
    mergedHuman = 0, // human-authored merged PRs (bot auto-merges don't reflect review discipline)
    reviewedHumanMerged = 0,
    draft = 0,
    revert = 0,
    bot = 0,
    aiInvolved = 0,
    reviewsSum = 0,
    commentsSum = 0,
    lineSum = 0,
    fileSum = 0,
    small = 0;
  const ttm: number[] = [];
  const ttfr: number[] = [];
  const toolCounts = new Map<string, number>();
  let aiApprovedCount = 0; // AI-involved PRs that received an approving review

  for (const pr of nodes) {
    const isMerged = pr.state === "MERGED" || !!pr.mergedAt;
    const approved = pr.reviews.nodes.some((r) => r.state === "APPROVED");
    const isBotAuthor = pr.author?.__typename === "Bot";
    if (pr.state === "OPEN") open++;
    if (isMerged) merged++;
    else if (pr.state === "CLOSED") closedUnmerged++;
    if (pr.isDraft) draft++;
    if (/^revert/i.test(pr.title)) revert++;

    reviewsSum += pr.reviews.totalCount;
    commentsSum += pr.comments.totalCount;
    const lines = pr.additions + pr.deletions;
    lineSum += lines;
    fileSum += pr.changedFiles;
    if (lines <= 200) small++;

    if (isMerged) {
      if (pr.mergedAt) {
        const h = hoursBetween(pr.mergedAt, pr.createdAt);
        if (h != null) ttm.push(h);
      }
      if (!isBotAuthor) {
        mergedHuman++;
        if (approved) reviewedHumanMerged++;
      }
    }
    const firstReview = pr.reviews.nodes
      .map((r) => r.submittedAt)
      .filter((s): s is string => !!s)
      .sort()[0];
    if (firstReview) {
      const h = hoursBetween(firstReview, pr.createdAt);
      if (h != null) ttfr.push(h);
    }

    const login = pr.author?.login ?? "";
    if (isBotAuthor) bot++;
    const haystack = `${login} ${pr.title} ${pr.bodyText?.slice(0, 1500) ?? ""} ${pr.labels.nodes
      .map((l) => l.name)
      .join(" ")}`;
    const aiAuthored = isBotAuthor && AI_AGENT.test(login);
    const aiMarked = AI_MARKER.test(haystack);
    if (aiAuthored || aiMarked) {
      aiInvolved++;
      if (approved) aiApprovedCount++;
      for (const t of AI_TOOLS) if (t.re.test(haystack)) toolCounts.set(t.name, (toolCounts.get(t.name) ?? 0) + 1);
    }
  }

  const tools = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    analyzed,
    totalCount,
    open,
    merged,
    closedUnmerged,
    mergeRate: pct(merged, merged + closedUnmerged),
    reviewedRate: pct(reviewedHumanMerged, mergedHuman),
    avgReviews: analyzed ? Math.round((reviewsSum / analyzed) * 10) / 10 : 0,
    avgComments: analyzed ? Math.round((commentsSum / analyzed) * 10) / 10 : 0,
    medianHoursToMerge: median(ttm),
    medianHoursToFirstReview: median(ttfr),
    avgLineChanges: analyzed ? Math.round(lineSum / analyzed) : 0,
    avgChangedFiles: analyzed ? Math.round(fileSum / analyzed) : 0,
    smallPrRate: pct(small, analyzed),
    botAuthoredRate: pct(bot, analyzed),
    aiInvolvedRate: pct(aiInvolved, analyzed),
    aiGovernedRate: aiInvolved >= 3 ? pct(aiApprovedCount, aiInvolved) : null,
    revertRate: pct(revert, analyzed),
    draftRate: pct(draft, analyzed),
    tools,
  };
}

/**
 * Fold pull-request signals into the deterministic dimension scores BEFORE the LLM blend, so
 * the Adoption × Rigor axes and posture reflect PR reality — not just file/commit signals:
 *   D6 (Quality, Rigor)    — review coverage + small-PR hygiene + low revert (bidirectional).
 *   D7 (Commits, Adoption) — AI showing up in PRs (additive: presence boosts, absence never penalizes).
 *   D8 (AI Process, Rigor) — are the AI-touched PRs actually reviewed? governed → lift, ungoverned → drag.
 */
export function applyPrSignals(
  signals: DimensionSignals[],
  pr: PrStats | null | undefined,
): DimensionSignals[] {
  if (!pr || pr.analyzed === 0) return signals;

  // PR-derived rigor: review discipline dominates; PR hygiene + stability round it out.
  const prRigor = clamp(0.5 * pr.reviewedRate + 0.3 * pr.smallPrRate + 0.2 * Math.max(0, 100 - pr.revertRate * 6));

  return signals.map((s) => {
    if (s.id === "D6") {
      return {
        ...s,
        signalScore: clamp(Math.round(0.65 * s.signalScore + 0.35 * prRigor)),
        signals: [
          ...s.signals,
          {
            label: `PR review coverage ${pr.reviewedRate}%`,
            detail: `${pr.merged} merged · ${pr.smallPrRate}% small · ${pr.revertRate}% reverted`,
          },
        ],
      };
    }
    if (s.id === "D7" && pr.aiInvolvedRate > 0) {
      // Additive only: AI in PRs is extra evidence of adoption; its absence isn't a penalty.
      const boost = Math.min(18, Math.round(pr.aiInvolvedRate * 0.5 + pr.tools.length * 3));
      return {
        ...s,
        signalScore: clamp(s.signalScore + boost),
        signals: [
          ...s.signals,
          {
            label: `AI involved in ${pr.aiInvolvedRate}% of PRs`,
            detail: pr.tools.map((t) => `${t.name} ${t.count}`).join(", ") || undefined,
          },
        ],
      };
    }
    if (s.id === "D8" && pr.aiGovernedRate != null) {
      // Systematic AI: are the AI-touched PRs reviewed? Governed → lift, ungoverned → drag.
      return {
        ...s,
        signalScore: clamp(Math.round(0.7 * s.signalScore + 0.3 * pr.aiGovernedRate)),
        signals: [
          ...s.signals,
          {
            label: `${pr.aiGovernedRate}% of AI PRs reviewed`,
            detail: pr.aiGovernedRate >= 60 ? "AI work is governed" : "AI work largely unreviewed",
          },
        ],
      };
    }
    return s;
  });
}

/**
 * Fold default-branch governance into the deterministic dimension scores (additive only —
 * presence of guardrails boosts; absence is neutral since classic-protection repos may not
 * expose their rules to a read token):
 *   D6 (Quality, Rigor)  — required PR reviews / code-owner review on main.
 *   D3 (CI/CD, Rigor)    — required status checks before merge.
 *   D8 (AI Process, Rigor) — branch is protected at all + signatures / linear history.
 */
export function applyGovernanceSignals(
  signals: DimensionSignals[],
  gov: Governance | null | undefined,
): DimensionSignals[] {
  if (!gov || !gov.readable) return signals;

  const evidence: { label: string; detail?: string }[] = [];
  if (gov.protected) evidence.push({ label: `Default branch \`${gov.defaultBranch}\` is protected`, detail: `${gov.ruleCount} rules` });
  if (gov.requiresPullRequest)
    evidence.push({
      label: "Pull requests required to merge",
      detail: gov.requiredApprovals > 0 ? `${gov.requiredApprovals} approval(s)${gov.requiresCodeOwnerReview ? " + code owners" : ""}` : undefined,
    });
  if (gov.requiresStatusChecks) evidence.push({ label: "Status checks required before merge" });
  if (gov.requiresSignatures) evidence.push({ label: "Signed commits required" });

  return signals.map((s) => {
    if (s.id === "D6" && gov.requiresPullRequest) {
      const boost = (gov.requiredApprovals > 0 ? 8 : 4) + (gov.requiresCodeOwnerReview ? 4 : 0);
      return { ...s, signalScore: clamp(s.signalScore + boost), signals: [...s.signals, evidence.find((e) => /Pull requests/.test(e.label))!].filter(Boolean) };
    }
    if (s.id === "D3" && gov.requiresStatusChecks) {
      return { ...s, signalScore: clamp(s.signalScore + 8), signals: [...s.signals, { label: "Status checks required before merge" }] };
    }
    if (s.id === "D8" && gov.protected) {
      const boost = 6 + (gov.requiresSignatures ? 3 : 0) + (gov.linearHistory ? 2 : 0);
      return {
        ...s,
        signalScore: clamp(s.signalScore + boost),
        signals: [...s.signals, { label: `Default branch protected (${gov.ruleCount} rules)`, detail: gov.requiresSignatures ? "signed commits" : undefined }],
      };
    }
    return s;
  });
}

/** Fetch + summarize a repo's recent PRs. Returns null only on transport failure. */
export async function fetchPrStats(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
  limit = 40,
): Promise<PrStats> {
  const { totalCount, nodes } = await fetchPullRequests(owner, repo, token, limit, signal);
  return summarizePullRequests(nodes, totalCount);
}
