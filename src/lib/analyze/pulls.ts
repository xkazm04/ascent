// Pull-request signal extraction. Turns a page of raw PR nodes into a PrStats summary that
// captures *how much* AI is involved and *how systematically* the team works around it
// (review coverage, PR size, velocity, agent authorship). Feeds the report + org dashboard
// now, and the maturity score in F4.

import { fetchPullRequests, type PrNode } from "@/lib/github/graphql";
import { clamp } from "@/lib/maturity/model";
import { AI_REVIEW_BOT_ALT, AI_TOOLS as AI_TOOL_VOCAB, AI_TOOL_ALT, AI_TRAILER_SOURCE } from "./ai-tools";
import { SMALL_PR_MAX_LINES } from "./pr-thresholds";
import type { AiChangeRecord, DimensionSignals, Governance, PrStats } from "@/lib/types";

// AI coding agents that open PRs as GitHub App bots (author.__typename === "Bot"). Derived from the
// single AI vocabulary (ai-tools.ts) so it can't drift from the commit/marker/counter detectors.
const AI_AGENT = new RegExp(`(${AI_TOOL_ALT})`, "i");
// AI fingerprints in PR title / body / labels (human-authored but AI-assisted). The tool-name
// alternations come from the shared vocabulary; the fixed phrases below are PR-specific markers.
const AI_MARKER = new RegExp(
  `(co-authored-by:\\s*(${AI_TOOL_ALT})|generated with (${AI_TOOL_ALT})|🤖|claude code|github copilot|made with cursor)`,
  "i",
);
const AI_TOOLS: { name: string; re: RegExp }[] = AI_TOOL_VOCAB.map((t) => ({ name: t.name, re: new RegExp(t.token, "i") }));
// Commit-message trailer attribution (W2) — the SAME trailer vocabulary the commit-level detector
// (index.ts AI_TRAILER) compiles, applied to a merged PR's merge-commit + PR-commit messages. This is
// the channel the title/body markers structurally miss: a squash-merged Claude Code PR whose author
// never wrote "🤖" in the description still carries `Co-Authored-By: Claude` in the squash commit.
const AI_TRAILER = new RegExp(AI_TRAILER_SOURCE, "i");
// AI REVIEW bots (CodeRabbit / Copilot code review / Greptile / …) — reviewers, not authors; the
// vocabulary is deliberately separate from AI_TOOL_ALT (see ai-tools.ts).
const AI_REVIEWER = new RegExp(`(${AI_REVIEW_BOT_ALT})`, "i");

/**
 * THE single "is this PR AI-involved" predicate (W2) — the one reading `summarizePullRequests` (the
 * rates) and `extractAiChanges` (the evidence rows) BOTH consume, so the population can never
 * disagree with its own percentage. Three channels, in precedence order:
 *   authored — an AI agent bot opened the PR;
 *   marked   — AI fingerprints in title / body(1500) / labels;
 *   trailer  — a MERGED PR whose merge-commit or PR-commit messages carry an AI attribution trailer.
 * `hasTrailer` is reported independently of the precedence (a marked PR that also carries a trailer
 * is `signal:"marked"` but still trailer-grounded — the honest numerator for `aiTrailerRate`).
 * `toolText` includes the commit messages, so per-tool attribution sees trailer-only tools too.
 */
function readAiInvolvement(pr: PrNode): {
  signal: "authored" | "marked" | "trailer" | null;
  hasTrailer: boolean;
  toolText: string;
} {
  const login = pr.author?.login ?? "";
  const isBotAuthor = pr.author?.__typename === "Bot";
  const isMerged = pr.state === "MERGED" || !!pr.mergedAt;
  const surface = `${login} ${pr.title} ${pr.bodyText?.slice(0, 1500) ?? ""} ${pr.labels.nodes
    .map((l) => l.name)
    .join(" ")}`;
  // Merge commit first (squash-merge — the dominant case), then the PR's own commits (rebase-merge).
  // Null-guarded per element: a partial GraphQL page can blank individual commit nodes.
  const commitText = [pr.mergeCommit?.message, ...(pr.commits?.nodes ?? []).map((n) => n?.commit?.message)]
    .filter((m): m is string => !!m)
    .join("\n");
  const hasTrailer = isMerged && commitText !== "" && AI_TRAILER.test(commitText);
  const signal =
    isBotAuthor && AI_AGENT.test(login) ? "authored" : AI_MARKER.test(surface) ? "marked" : hasTrailer ? "trailer" : null;
  return { signal, hasTrailer, toolText: `${surface}\n${commitText}` };
}

/**
 * AI pre-review (W2): did an AI/bot reviewer submit a review BEFORE the first human review (or is
 * there an AI review and no human review at all)? An AI reviewer is a login in the review-bot
 * vocabulary, or a Bot-typed account matching the AI-agent vocabulary (e.g. `copilot[bot]`); a
 * deleted account (null author) counts as human — the conservative read. Pending reviews (null
 * submittedAt) are ignored: an unsubmitted review pre-reviewed nothing.
 */
function aiPreReviewed(pr: PrNode): boolean {
  let firstAi: string | null = null;
  let firstHuman: string | null = null;
  for (const r of pr.reviews.nodes) {
    if (!r.submittedAt) continue;
    const login = r.author?.login ?? "";
    const isAi = AI_REVIEWER.test(login) || (r.author?.__typename === "Bot" && AI_AGENT.test(login));
    if (isAi) {
      if (firstAi === null || r.submittedAt < firstAi) firstAi = r.submittedAt;
    } else if (firstHuman === null || r.submittedAt < firstHuman) {
      firstHuman = r.submittedAt;
    }
  }
  return firstAi !== null && (firstHuman === null || firstAi <= firstHuman);
}

// ── Revert linkage (W5, tier A — deterministic, zero extra API calls) ─────────
//
// Within the fetched PR window, match merged REVERT PRs to the merged PRs they roll back, through
// the two artifacts GitHub's own revert flow produces:
//   title   — the revert PR is titled `Revert "<original title>"` (exact inner-title match);
//   message — its body / merge-commit / PR-commit messages carry `This reverts commit <sha>`,
//             resolved against the target PRs' merge-commit + PR-commit SHAs (prefix-tolerant).
// The result is a LOWER BOUND by construction: a manually renamed revert, a revert whose target
// merged before the window, or a revert that lands after the scan all escape. That is disclosed on
// every field this feeds (PrStats.reworkRate / aiReworkRate, AiChange.revertedByPr) — the honest
// framing is "at least this share was rolled back", never a census.

const REVERT_TITLE = /^\s*revert\b/i;
const REVERT_QUOTED = /revert\s+"(.+)"\s*$/i;
const REVERTS_COMMIT = /this reverts commit\s+([0-9a-f]{7,40})/gi;

/** All commit messages we fetched for a PR (merge commit first, then its own commits). */
const commitMessages = (pr: PrNode): string[] =>
  [pr.mergeCommit?.message, ...(pr.commits?.nodes ?? []).map((n) => n?.commit?.message)].filter((m): m is string => !!m);

/** All commit SHAs we fetched for a PR (same nodes as the messages; absent on pre-W5 shapes). */
const commitShas = (pr: PrNode): string[] =>
  [pr.mergeCommit?.oid, ...(pr.commits?.nodes ?? []).map((n) => n?.commit?.oid)].filter((s): s is string => !!s).map((s) => s.toLowerCase());

/**
 * Map of reverted-PR number → the merged revert PR that rolled it back (earliest revert wins).
 * Only MERGED reverts count (an open revert PR hasn't reverted anything yet), only MERGED PRs can be
 * targets, and a title match additionally requires the target to have merged BEFORE the revert —
 * two same-titled PRs must not link backwards. SHA matches are unambiguous and need no such guard.
 */
export function linkReverts(nodes: PrNode[]): Map<number, { byPr: number; at: string | null }> {
  const merged = nodes.filter((pr) => pr.state === "MERGED" || !!pr.mergedAt);
  if (merged.length < 2) return new Map();

  const byTitle = new Map<string, PrNode[]>();
  const bySha: { sha: string; pr: PrNode }[] = [];
  for (const pr of merged) {
    const t = pr.title.trim();
    const list = byTitle.get(t);
    if (list) list.push(pr);
    else byTitle.set(t, [pr]);
    for (const sha of commitShas(pr)) bySha.push({ sha, pr });
  }

  const out = new Map<number, { byPr: number; at: string | null }>();
  const record = (target: PrNode, revert: PrNode) => {
    if (target.number === revert.number) return;
    const prev = out.get(target.number);
    // Earliest revert wins — the first roll-back is the rework event; later re-reverts don't move it.
    // (A null mergedAt sorts last via the "￿" sentinel, so a timestamped revert always beats it.)
    if (!prev || (revert.mergedAt ?? "￿") < (prev.at ?? "￿")) {
      out.set(target.number, { byPr: revert.number, at: revert.mergedAt });
    }
  };

  for (const revert of merged) {
    const isTitledRevert = REVERT_TITLE.test(revert.title);
    // `This reverts commit <sha>` appears in the revert's body (GitHub's generated PR body) and in
    // its commit messages — scan both. Cheap guard: only PRs that even mention a revert.
    const revertText = `${revert.bodyText ?? ""}\n${commitMessages(revert).join("\n")}`;
    const mentionsSha = revertText.toLowerCase().includes("this reverts commit");
    if (!isTitledRevert && !mentionsSha) continue;

    if (isTitledRevert) {
      const inner = REVERT_QUOTED.exec(revert.title.trim())?.[1];
      for (const target of inner ? (byTitle.get(inner.trim()) ?? []) : []) {
        // Chronology guard for title matches: the target merged before the revert did.
        if (target.mergedAt && revert.mergedAt && target.mergedAt < revert.mergedAt) record(target, revert);
      }
    }
    if (mentionsSha) {
      for (const m of revertText.matchAll(REVERTS_COMMIT)) {
        const sha = m[1]!.toLowerCase();
        for (const { sha: candidate, pr: target } of bySha) {
          // Prefix-tolerant both ways: messages often carry the full 40-char SHA, humans abbreviate.
          if (candidate.startsWith(sha) || sha.startsWith(candidate)) record(target, revert);
        }
      }
    }
  }
  return out;
}

function median(xs: number[]): number | null {
  // Drop any non-finite entries first: a single malformed timestamp upstream would otherwise
  // make the comparator return NaN (unstable sort) and can yield a NaN median.
  const finite = xs.filter((x) => Number.isFinite(x));
  if (!finite.length) return null;
  const s = finite.sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  // safe: `finite` is non-empty (checked above), so mid is in-bounds; for even length mid >= 1.
  const v = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
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

export function summarizePullRequests(rawNodes: (PrNode | null)[], totalCount: number): PrStats {
  // A partial GraphQL page (node-level errors) can hand us null array slots for the PRs that failed
  // to resolve; the loop below dereferences every node (`pr.state`, `pr.reviews…`), so drop the
  // nulls up front rather than NPE on one. `analyzed` then reflects the PRs we could summarize.
  const nodes = rawNodes.filter((n): n is PrNode => n != null);
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
  let aiAuthoredPrs = 0, // per-channel counts (precedence authored > marked > trailer) — sum to aiInvolved
    aiMarkedPrs = 0,
    aiTrailerPrs = 0,
    trailerMerged = 0, // merged PRs carrying an AI trailer, regardless of channel precedence
    preReviewedMerged = 0; // merged PRs with an AI/bot review before the first human review
  let revertedMerged = 0, // merged PRs later reverted by another merged PR in the window (W5)
    aiInvolvedMerged = 0, // merged PRs that are AI-involved (the aiReworkRate denominator)
    aiRevertedMerged = 0; // …of those, the ones later reverted (its numerator)
  // W5 revert linkage — one pass over the same nodes, no extra fetches.
  const reverts = linkReverts(nodes);

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
    if (lines <= SMALL_PR_MAX_LINES) small++;

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

    if (isBotAuthor) bot++;
    // One shared predicate for all three channels — the same read extractAiChanges makes.
    const ai = readAiInvolvement(pr);
    if (ai.signal !== null) {
      aiInvolved++;
      if (ai.signal === "authored") aiAuthoredPrs++;
      else if (ai.signal === "marked") aiMarkedPrs++;
      else aiTrailerPrs++;
      if (approved) aiApprovedCount++;
      for (const t of AI_TOOLS) if (t.re.test(ai.toolText)) toolCounts.set(t.name, (toolCounts.get(t.name) ?? 0) + 1);
    }
    if (isMerged) {
      if (ai.hasTrailer) trailerMerged++;
      if (aiPreReviewed(pr)) preReviewedMerged++;
      const reverted = reverts.has(pr.number);
      if (reverted) revertedMerged++;
      if (ai.signal !== null) {
        aiInvolvedMerged++;
        if (reverted) aiRevertedMerged++;
      }
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
    // No human-authored merged PR in the window (e.g. an all-bot/agent fleet) means review
    // discipline was never measurable — null, NOT a fabricated "0% reviewed" that would drag D6
    // and feed the LLM auditor a stated falsehood (same measured-zero vs no-sample class as
    // aiGovernedRate below and the failed-detector exclusion).
    // Minimum-sample floor (ambiguity-ui 2026-07-16 maturity #2): the SAME >= 5 floor as
    // aiGovernedRate, for the same statistical reason — at 1–4 human-merged PRs a single
    // unreviewed (e.g. self-merged) PR swings the rate 25–100pts, drags D6 through prRigor's 0.5
    // weight, and can flip the rigor axis / posture near the 50 threshold off a meaningless
    // sample. Below the floor the rate is null ("not measurable"), and applyPrSignals
    // renormalizes prRigor over the measurable hygiene/stability terms. Keep this floor in
    // lockstep with aiGovernedRate's `>= 5` below.
    reviewedRate: mergedHuman >= 5 ? pct(reviewedHumanMerged, mergedHuman) : null,
    avgReviews: analyzed ? Math.round((reviewsSum / analyzed) * 10) / 10 : 0,
    avgComments: analyzed ? Math.round((commentsSum / analyzed) * 10) / 10 : 0,
    medianHoursToMerge: median(ttm),
    medianHoursToFirstReview: median(ttfr),
    avgLineChanges: analyzed ? Math.round(lineSum / analyzed) : 0,
    avgChangedFiles: analyzed ? Math.round(fileSum / analyzed) : 0,
    smallPrRate: pct(small, analyzed),
    botAuthoredRate: pct(bot, analyzed),
    aiInvolvedRate: pct(aiInvolved, analyzed),
    // Require a meaningful sample before deriving a governance RATE that drags a scored dimension (D8,
    // 12% weight) via applyPrSignals. At the old `>= 3` floor, a single unreviewed AI PR in a 3-PR
    // window swings the rate ~33pts and can flip the rigor axis / posture near the 50 threshold off a
    // 3-PR sample. 5 is the minimum where the rate isn't dominated by one PR; below it stays null
    // (D8 gets no PR-governance signal, the same as 1-2 AI PRs).
    aiGovernedRate: aiInvolved >= 5 ? pct(aiApprovedCount, aiInvolved) : null,
    revertRate: pct(revert, analyzed),
    draftRate: pct(draft, analyzed),
    tools,
    aiAuthoredPrs,
    aiMarkedPrs,
    aiTrailerPrs,
    // Merged-PR-denominated rates (W2), behind the SAME >= 5 sample floor as reviewedRate /
    // aiGovernedRate above and for the same statistical reason: at 1–4 merged PRs one squash commit
    // swings the rate 25–100pts. Below the floor: null ("not measurable"), never a fabricated 0.
    aiTrailerRate: merged >= 5 ? pct(trailerMerged, merged) : null,
    aiPreReviewedRate: merged >= 5 ? pct(preReviewedMerged, merged) : null,
    // W5: revert-linkage rates. Same ≥5 merged floor as the W2 rates above; the AI split ADDITIONALLY
    // floors on its own denominator (≥5 AI-involved merged PRs) — at 1–4 AI merges one revert swings
    // the rate 25–100pts. Both are LOWER BOUNDS (see linkReverts): null means "not measurable",
    // a number means "at least this share was rolled back in the window".
    reworkRate: merged >= 5 ? pct(revertedMerged, merged) : null,
    aiReworkRate: merged >= 5 && aiInvolvedMerged >= 5 ? pct(aiRevertedMerged, aiInvolvedMerged) : null,
    mergedShas: mergeShaIndex(nodes),
  };
}

/**
 * W4 — the merge-sha index: one entry per MERGED PR with a merge commit, flagging AI attribution.
 *
 * Every input is already in hand (`mergeCommit.oid` has been paged since W5's revert linkage;
 * `readAiInvolvement` is the same detector the rates use), so this costs no extra API call and
 * cannot disagree with the AiChange rows written from the same nodes.
 *
 * A squash- or rebase-merged PR still has a merge commit oid, so it indexes normally. What does NOT
 * appear: PRs merged outside the scanned window, and deploys of a tag or a hand-built merge train —
 * those surface downstream as attribution coverage, never as a silently smaller denominator.
 */
export function mergeShaIndex(nodes: PrNode[]): { s: string; a: 0 | 1 }[] {
  const out: { s: string; a: 0 | 1 }[] = [];
  const seen = new Set<string>();
  for (const pr of nodes) {
    if (pr.state !== "MERGED" && !pr.mergedAt) continue;
    const sha = pr.mergeCommit?.oid?.toLowerCase();
    if (!sha || seen.has(sha)) continue;
    seen.add(sha);
    out.push({ s: sha, a: readAiInvolvement(pr).signal !== null ? 1 : 0 });
  }
  return out;
}

/**
 * Fold pull-request signals into the deterministic dimension scores BEFORE the LLM blend, so
 * the Adoption × Rigor axes and posture reflect PR reality — not just file/commit signals:
 *   D4 (AI Tooling, Adoption) — an AI reviewer OBSERVED reviewing merged PRs (additive).
 *   D6 (Quality, Rigor)    — review coverage + small-PR hygiene + low revert (bidirectional).
 *   D7 (Commits, Adoption) — AI showing up in PRs (additive: presence boosts, absence never penalizes).
 *   D8 (AI Process, Rigor) — are the AI-touched PRs actually reviewed? governed → lift, ungoverned → drag.
 */
export function applyPrSignals(
  signals: DimensionSignals[],
  pr: PrStats | null | undefined,
  opts?: { offPlatformReview?: boolean },
): DimensionSignals[] {
  if (!pr || pr.analyzed === 0) return signals;

  // When code review happens OFF GitHub (Gerrit / bors merge-queue — detected from commit trailers),
  // GitHub's reviewedRate is a misleading 0%/low that would drag D6 even though the real gate is
  // stricter. Treat it as "no sample" (null) so it drops out; the off-platform review is credited as a
  // positive signal in the D6 detector. Otherwise use the measured rate unchanged.
  const reviewedRate = opts?.offPlatformReview ? null : pr.reviewedRate;

  // PR-derived rigor: review discipline dominates; PR hygiene + stability round it out.
  // When review coverage has NO usable sample (reviewedRate null — fewer than 5 human-authored
  // merged PRs, or off-platform review), drop the review term and renormalize the remaining weights (0.3/0.5 and
  // 0.2/0.5) so the measurable hygiene/stability signals still count without a fabricated 0% dragging D6.
  const stability = Math.max(0, 100 - pr.revertRate * 6);
  const prRigor = clamp(
    reviewedRate == null
      ? 0.6 * pr.smallPrRate + 0.4 * stability
      : 0.5 * reviewedRate + 0.3 * pr.smallPrRate + 0.2 * stability,
  );

  return signals.map((s) => {
    // A detector that crashed emits a placeholder signalScore:0 (not a real measurement) — blending
    // real PR/governance evidence over that placeholder makes a crashed detector look like a
    // genuinely-scored, evidenced dimension. engine.ts currently drops `failed` dimensions downstream
    // (masking this today), but any future reader of `signals[]` that doesn't re-check `.failed` would
    // surface fabricated evidence attached to a crashed detector (G3-08). Leave it untouched.
    if (s.failed) return s;
    if (s.id === "D6") {
      return {
        ...s,
        signalScore: clamp(Math.round(0.65 * s.signalScore + 0.35 * prRigor)),
        signals: [
          ...s.signals,
          {
            label:
              reviewedRate == null
                ? opts?.offPlatformReview
                  ? "PR review coverage n/a (review runs off-GitHub, credited in D6)"
                  : "PR review coverage n/a (fewer than 5 human-merged PRs in window)"
                : `PR review coverage ${reviewedRate}%`,
            detail: `${pr.merged} merged · ${pr.smallPrRate}% small · ${pr.revertRate}% reverted`,
          },
        ],
      };
    }
    if (s.id === "D4" && pr.aiPreReviewedRate != null && pr.aiPreReviewedRate > 0) {
      // D4 (AI tooling) from OBSERVED behavior rather than committed config: an AI/bot reviewer that
      // actually submitted a review before the first human one on merged PRs. A repo can configure a
      // review bot and never let it run; this is the half that proves the tool is in the loop.
      // Additive only (absence is not a penalty — an anonymous scan can't see reviews at all), and
      // capped harder when the file detector already found the bot's config: the same tool observed
      // twice is confirmation, not a second discovery.
      const configured = s.signals.some((x) => x.label.startsWith("AI code-review agent"));
      const credit = Math.min(configured ? 8 : 20, Math.round(pr.aiPreReviewedRate * 0.4));
      return {
        ...s,
        signalScore: clamp(s.signalScore + credit),
        signals: [
          ...s.signals,
          {
            label: `AI reviewer active on ${pr.aiPreReviewedRate}% of merged PRs`,
            detail:
              "an AI/bot reviewer submitted a review before the first human review (Copilot code review, CodeRabbit, …)",
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
    // Same guard as applyPrSignals above: never decorate a crashed detector's placeholder score with
    // real-looking governance evidence (G3-08).
    if (s.failed) return s;
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

/** Fetch + summarize a repo's recent PRs, paired with the `partial` flag from the underlying
 *  GraphQL walk. `partial` is true when a page returned `data` AND `errors` (a silently-incomplete
 *  PR slice while `totalCount` still reports the true repo-wide count): the caller MUST annotate the
 *  report "based on partial data" and NOT cache/persist the scan as authoritative, rather than
 *  serving an under-stated review/AI-process score as complete (github-repo-data-access #1). A
 *  complete result reports `partial:false`.
 *  THROWS on transport failure (the underlying `fetchPullRequests` rejects) — it never resolves to
 *  null; the return type is non-nullable. Callers that want to degrade PR-less must wrap the call
 *  (see scan.ts: `.catch(() => null)`). */
export async function fetchPrStats(
  owner: string,
  repo: string,
  token: string,
  signal?: AbortSignal,
  limit = 40,
): Promise<{ stats: PrStats; partial: boolean; aiChanges: AiChangeRecord[] }> {
  const { totalCount, nodes, partial } = await fetchPullRequests(owner, repo, token, limit, signal);
  // `partial` is omitted upstream on a complete result, so coerce to a definite boolean here.
  // The evidence rows come off the SAME nodes as the rates — one fetch, two readings, no extra cost.
  return { stats: summarizePullRequests(nodes, totalCount), partial: Boolean(partial), aiChanges: extractAiChanges(nodes) };
}

// ── The AI-change population (evidence rows, not rates) ───────────────────────
//
// summarizePullRequests reduces these same nodes to percentages and discards the PRs. That is enough
// to say "62% of AI PRs were approved" and NOT enough to answer the question an auditor actually asks:
// show me the population of AI-assisted changes in the period, let me sample it, and evidence the
// review control for each sampled item. Extracting the rows costs one more pass over data already in
// memory — no extra GitHub calls.
//
// Deliberately kept as a PURE function beside the summarizer, so both readings of "is this PR
// AI-involved" come from the same detectors and can never drift apart.

/**
 * The AI-involved subset of a PR page, as evidence rows.
 *
 * Detection is IDENTICAL to summarizePullRequests (both call the shared readAiInvolvement predicate —
 * authored / marked / trailer), so the population here always reconciles with the `aiInvolvedRate`
 * shown next to it — a governance artifact whose row count disagreed with its own percentage would be
 * worse than no artifact.
 *
 * The approver is the FIRST approving review in submission order, which is the reviewer who actually
 * unblocked the merge. `approved: true` with a null `approverLogin` is a real case (deleted account),
 * not an error — and is exactly why the boolean and the name are separate fields rather than one
 * nullable name.
 */
export type { AiChangeRecord };

export function extractAiChanges(nodes: PrNode[]): AiChangeRecord[] {
  const out: AiChangeRecord[] = [];
  // The SAME linkage the summarizer computes (linkReverts is pure and cheap), so a stamped evidence
  // row can never disagree with the aiReworkRate shown beside it.
  const reverts = linkReverts(nodes);
  for (const pr of nodes) {
    // The SAME shared predicate the summarizer uses (readAiInvolvement) — one detector, two readings.
    const ai = readAiInvolvement(pr);
    if (ai.signal === null) continue;

    // Earliest APPROVED review by submission time. A null submittedAt (a pending review) sorts last so
    // it can never be picked as "the approval" ahead of a real, timestamped one.
    const approvals = pr.reviews.nodes
      .filter((r) => r.state === "APPROVED")
      .sort((a, b) => (a.submittedAt ?? "\uffff").localeCompare(b.submittedAt ?? "\uffff"));
    const first = approvals[0];

    out.push({
      prNumber: pr.number,
      title: pr.title,
      authorLogin: pr.author?.login ?? null,
      authorIsBot: pr.author?.__typename === "Bot",
      // An agent-authored PR, a human-marked one, and a trailer-only one carry very different
      // governance weight, and it is the first thing asked about a sampled row — so record which
      // channel matched (precedence authored > marked > trailer) rather than re-deriving it later
      // from a title regex that may have moved on.
      aiSignal: ai.signal,
      aiTools: AI_TOOLS.filter((t) => t.re.test(ai.toolText)).map((t) => t.name),
      state: pr.state,
      mergedAt: pr.mergedAt,
      approved: Boolean(first),
      approverLogin: first?.author?.login ?? null,
      approvedAt: first?.submittedAt ?? null,
      reviewCount: pr.reviews.totalCount,
      createdAt: pr.createdAt,
      // W5 revert linkage — a lower bound (window-scoped matcher); null is "no revert matched", not
      // "never reverted". Stamped as a pair or not at all.
      revertedByPr: reverts.get(pr.number)?.byPr ?? null,
      revertedAt: reverts.get(pr.number)?.at ?? null,
      // W4 — free: `mergeCommit.oid` has been paged since W5's revert linkage and thrown away.
      // Lower-cased to match how deployment SHAs are normalized on the other side of the join.
      mergeCommitSha: pr.mergeCommit?.oid ? pr.mergeCommit.oid.toLowerCase() : null,
    });
  }
  return out;
}
