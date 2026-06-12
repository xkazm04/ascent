// Builds the prompt sent to any LLM provider. Kept provider-agnostic so Gemini and
// (Phase 2) Bedrock share identical instructions and output contract.

import type { LlmScoreInput } from "@/lib/llm/provider";
import type { Governance, PrStats } from "@/lib/types";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";

// PrStats rates are ALREADY 0..100 integers (pulls.ts `pct`; "All rates are 0..100", types.ts) —
// render as-is. A second ×100 here told the model "merge rate 8500%" on every tokened scan.
const pct = (n: number): string => `${Math.round(n)}%`;

/**
 * Render the PR + branch-protection evidence the scan already computed (and folded into the
 * deterministic D3/D6/D7/D8 scores) so the LLM auditor reasons about review discipline, merge
 * velocity, AI governance, and merge gating instead of guessing. Degrades to a one-line note when
 * the repo was scanned without a token (no PR/governance access).
 */
function processBlock(prStats?: PrStats | null, governance?: Governance | null): string {
  if (!prStats && !governance) {
    return "(unavailable — scanned without a token, so PR and branch-protection signals were skipped.)";
  }
  const lines: string[] = [];
  if (prStats && prStats.analyzed > 0) {
    const h = (v: number | null) => (v == null ? "n/a" : `${v}h`);
    const aiGov = prStats.aiGovernedRate == null ? "n/a (too few AI PRs)" : pct(prStats.aiGovernedRate);
    const reviewed = prStats.reviewedRate == null ? "n/a (no human-merged PRs)" : pct(prStats.reviewedRate);
    lines.push(
      `- Pull requests: ${prStats.analyzed} analyzed of ${prStats.totalCount} total; merge rate ${pct(prStats.mergeRate)}, reviewed rate ${reviewed} (merged PRs with an approving review), avg ${prStats.avgReviews} reviews/PR.`,
      `- Velocity & size: median time-to-merge ${h(prStats.medianHoursToMerge)}, median time-to-first-review ${h(prStats.medianHoursToFirstReview)}; small-PR rate ${pct(prStats.smallPrRate)} (≤200 line changes).`,
      `- AI in PRs: AI-involved rate ${pct(prStats.aiInvolvedRate)}; of those, governed (reviewed) rate ${aiGov}.`,
    );
  } else if (prStats) {
    lines.push("- Pull requests: none analyzed in the window.");
  }
  if (governance) {
    const yn = (b: boolean) => (b ? "yes" : "no");
    lines.push(
      !governance.readable
        ? `- Branch protection (${governance.defaultBranch}): could not be read (insufficient permission).`
        : `- Branch protection (${governance.defaultBranch}): ${governance.protected ? "protected" : "NOT protected"}; requires PR ${yn(governance.requiresPullRequest)}, required approvals ${governance.requiredApprovals}, status checks ${yn(governance.requiresStatusChecks)}, code-owner review ${yn(governance.requiresCodeOwnerReview)}, signatures ${yn(governance.requiresSignatures)}, linear history ${yn(governance.linearHistory)}, ${governance.ruleCount} ruleset rule(s).`,
    );
  }
  return lines.join("\n");
}

const SYSTEM = `You are Ascent, an expert assessor of how "AI-native" a software engineering organization is, based on evidence read from a GitHub repository. You apply a fixed, published rubric and you are rigorous and evidence-driven. You never invent facts: every judgment must be supported by the signals and file excerpts provided. Calibrate dimension scores to the deterministic signal scores you are given (nuance within a small band). However, the deterministic detectors are imperfect — in the "discrepancies" field you SHOULD actively flag any signal you believe is wrong given the file excerpts (e.g. tests or config clearly present but the signal missed them). Catching detector misses is part of your job; don't be shy. Respond with JSON only, matching the requested schema exactly.`;

function rubric(): string {
  const levels = LEVELS.map(
    (l) => `- ${l.id} ${l.name} (${l.band[0]}-${l.band[1]}): ${l.description}`,
  ).join("\n");
  const dims = DIMENSIONS.map(
    (d) =>
      `- ${d.id} ${d.name} (weight ${Math.round(d.weight * 100)}%): ${d.criteria}`,
  ).join("\n");
  return `MATURITY LEVELS:\n${levels}\n\nSCORING DIMENSIONS:\n${dims}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "\n…[truncated]" : s;
}

export function buildAssessmentPrompt(input: LlmScoreInput): {
  system: string;
  user: string;
} {
  const { repo, signals, files, commitSample, archetype, prStats, governance } = input;

  const signalBlock = signals
    .map((s) => {
      const ev = s.signals
        .map((x) => `    - ${x.label}${x.detail ? ` (${x.detail})` : ""}`)
        .join("\n");
      return `  ${s.id} signalScore=${s.signalScore}\n${ev || "    - (none)"}`;
    })
    .join("\n");

  // Concatenate file excerpts only up to the prompt's byte window (OUTER). Each file is capped to
  // a small excerpt (PER_FILE); we stop the moment the running block reaches OUTER, since the
  // outer truncate below discards anything past it — so we don't build a ~70KB string just to
  // slice ~two-thirds of it off. The output is byte-identical to truncating the full join.
  //
  // NOTE: ingestion (github/source.ts) deliberately fetches MORE per file than this window. The
  // deterministic detectors in analyze/index.ts read the FULL file content with length thresholds
  // (e.g. CLAUDE.md >= 4k chars -> D1, README >= 1.5k -> D5), so the fetch budget is sized for the
  // scorer's needs, not this LLM prompt window. Don't "align" them by shrinking the fetch budget.
  const PER_FILE = 2200;
  const OUTER = 22000;
  let joined = "";
  for (const f of files) {
    const block = `### ${f.path}\n\`\`\`\n${truncate(f.content, PER_FILE)}\n\`\`\``;
    joined = joined ? `${joined}\n\n${block}` : block;
    if (joined.length >= OUTER) break;
  }
  const fileBlock = truncate(joined, OUTER);

  const commitBlock = commitSample.length
    ? commitSample.map((m) => `- ${m.replace(/\n/g, " ").slice(0, 120)}`).join("\n")
    : "(no commit history available)";

  const user = `Assess this repository's AI-native engineering maturity.

REPOSITORY
- ${repo.owner}/${repo.name}
- Language: ${repo.primaryLanguage ?? "unknown"} | Stars: ${repo.stars} | Last push: ${repo.pushedAt ?? "?"}
- Description: ${repo.description ?? "(none)"}
- Inferred run-style: ${archetype} (solo/early, team/product, or org/platform) — judge maturity in this context.

${rubric()}

DETERMINISTIC SIGNALS (computed from the repo; treat as ground truth and calibrate to these):
${signalBlock}

PROCESS SIGNALS (review discipline, merge velocity, AI governance, branch protection — the behavioral evidence behind D3/D6/D7/D8; calibrate those dimensions to this too):
${processBlock(prStats, governance)}

RECENT COMMIT MESSAGES (sample):
${commitBlock}

SAMPLED FILES:
${fileBlock}

TASK
For each of the ${DIMENSIONS.length} dimensions (D1..D${DIMENSIONS.length}) return a score 0-100 (calibrated to its signalScore),
a one-paragraph summary, up to 4 concrete strengths, and up to 4 concrete gaps — all grounded
in the evidence above. Then give an overall headline sentence, 3-5 org-level strengths, 3-5
risks, and a prioritized roadmap of 3-5 entries.

IMPORTANT — Ascent is a transition COMPANION, not a boss. The roadmap surfaces *gaps in the
level of trust* (how much the team can trust AI in its workflow) as things to EXPLORE, never as
orders. For each entry: "title" names the gap as an observation (e.g. "Agent guidance is thin —
agents have little to go on"), NOT an imperative ("Add a CLAUDE.md"). "rationale" explains why
the gap matters for AI-driven development. "explore" is 2-3 invitational questions that help the
team discover the gap themselves (open questions, not steps). Also include dimension, impact
high|medium|low, effort high|medium|low, and a levelUnlock like "L3->L4". Phrasing must be
invitational throughout — provide inputs to explore, not directives to follow.

Finally, act as an AUDITOR: list any "discrepancies" — dimensions where you believe the
deterministic signalScore is WRONG based on the sampled file evidence (e.g. tests clearly
exist but the signal reported none, or a config was missed). Each is a one-sentence claim
citing the evidence. Return an empty array if the signals look correct.

Respond with JSON only in exactly this shape:
{
  "dimensions": [{"id":"D1","score":0,"summary":"","strengths":[""],"gaps":[""]}],
  "headline": "",
  "strengths": [""],
  "risks": [""],
  "roadmap": [{"title":"","dimension":"D3","impact":"high","effort":"low","rationale":"","explore":["",""],"levelUnlock":"L2->L3"}],
  "discrepancies": [{"dimension":"D2","claim":"A test.js file is present but D2 detected 0 tests."}]
}`;

  return { system: SYSTEM, user };
}
