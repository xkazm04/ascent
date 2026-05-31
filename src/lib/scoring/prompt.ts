// Builds the prompt sent to any LLM provider. Kept provider-agnostic so Gemini and
// (Phase 2) Bedrock share identical instructions and output contract.

import type { LlmScoreInput } from "@/lib/llm/provider";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";

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
  const { repo, signals, files, commitSample, archetype } = input;

  const signalBlock = signals
    .map((s) => {
      const ev = s.signals
        .map((x) => `    - ${x.label}${x.detail ? ` (${x.detail})` : ""}`)
        .join("\n");
      return `  ${s.id} signalScore=${s.signalScore}\n${ev || "    - (none)"}`;
    })
    .join("\n");

  const fileBlock = files
    .map((f) => `### ${f.path}\n\`\`\`\n${truncate(f.content, 2200)}\n\`\`\``)
    .join("\n\n");

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

RECENT COMMIT MESSAGES (sample):
${commitBlock}

SAMPLED FILES:
${truncate(fileBlock, 22000)}

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
