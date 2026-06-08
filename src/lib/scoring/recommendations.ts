// A deterministic catalog of "next step" recommendations per dimension. Used by the
// MockProvider (keyless demo) and as a fallback when the LLM returns an empty roadmap.
// Steps are ranked by *weighted upside* under the repo's archetype lens, so a solo repo
// is steered toward tooling/tests/docs rather than org-scale CI it doesn't need yet.

import type { DimensionId, DimensionSignals, LlmRoadmapItem, RepoArchetype } from "@/lib/types";
import { DIMENSION_BY_ID, LEVELS, levelForScore, weightsFor } from "@/lib/maturity/model";

interface RecTemplate {
  title: string;
  impact: "high" | "medium" | "low";
  effort: "high" | "medium" | "low";
  rationale: string;
  /** Invitational questions — inputs to explore the gap, not steps to execute. */
  explore: string[];
}

// Each entry frames a *gap in the level of trust*: what's thin, why it matters for AI-driven
// development, and questions to explore — never an order. Phrasing stays invitational.
const CATALOG: Record<DimensionId, RecTemplate> = {
  D1: {
    title: "Agent guidance is thin — agents have little to go on here",
    impact: "high",
    effort: "low",
    rationale:
      "Substantive, machine-readable guidance (build/test commands, an architecture map, the rules a change must never break) is what lets an AI contribution land consistently and on-spec. A token stub barely moves trust.",
    explore: [
      "What would an AI agent need to know to make a safe change here — commands, architecture, the constraints it must never break?",
      "Where do new contributors (human or AI) get stuck today for lack of written context?",
    ],
  },
  D2: {
    title: "Few tests vouch for behavior — little catches a bad change",
    impact: "high",
    effort: "medium",
    rationale:
      "Tests are the guardrail that makes AI-generated code safe to merge; without them, autonomy can't compound because nothing independently confirms the change is right.",
    explore: [
      "If an agent proposed a change tomorrow, what would catch a regression before it merged?",
      "Which critical behaviors currently have no test to vouch for them?",
    ],
  },
  D3: {
    title: "Little gates what reaches main — trust rests on who reviewed",
    impact: "high",
    effort: "low",
    rationale:
      "A CI gate turns guardrails into enforcement, so trust doesn't depend on a particular reviewer — neither humans nor agents can merge a regression past it.",
    explore: [
      "What stops an untrusted change from reaching main today?",
      "Could every PR's checks run automatically, so trust isn't a function of who looked?",
    ],
  },
  D4: {
    title: "AI isn't in the loop yet — it's at most at the keyboard",
    impact: "high",
    effort: "medium",
    rationale:
      "AI review, auto-fix, and evals for generated output are the jump from 'AI at the keyboard' to a pipeline that can trust an agent's first pass.",
    explore: [
      "Where could an agent take the first pass — review, triage, codegen — with a human just confirming?",
      "What would you need in place to trust an agent's output without reading every line?",
    ],
  },
  D5: {
    title: "Sparse docs/ADRs — context lives in people's heads",
    impact: "medium",
    effort: "low",
    rationale:
      "Docs and decision records that both humans and agents can read cut context-gathering cost and raise the quality (and trustworthiness) of AI contributions.",
    explore: [
      "What context do you re-explain often that could live in docs an agent can read?",
      "Which past decisions would a newcomer (or agent) misjudge for lack of an ADR?",
    ],
  },
  D6: {
    title: "Conventions held by habit, not enforced by tooling",
    impact: "medium",
    effort: "low",
    rationale:
      "Strict, enforced guardrails (types, linters, hooks) catch AI and human slips at the earliest point and keep the codebase coherent even at AI speed.",
    explore: [
      "Which conventions are kept by habit rather than enforced automatically?",
      "Where would strict types or a linter catch a slip earliest?",
    ],
  },
  D7: {
    title: "AI's footprint in history is hard to see or measure",
    impact: "low",
    effort: "low",
    rationale:
      "A legible, attributable change history lets you see where AI helped and how it fared, and gives downstream automation reliable signals to build on.",
    explore: [
      "Can you tell which changes were AI-assisted, and whether they held up?",
      "What would make your change history legible to downstream automation?",
    ],
  },
  D8: {
    title: "AI use is ad hoc — no shared process or harness",
    impact: "high",
    effort: "medium",
    rationale:
      "Evals for generated output, versioned prompts/agents, runbooks, and a review gate turn ad-hoc prompting into a repeatable, trustworthy part of how the team ships.",
    explore: [
      "How do you know an AI-generated change is good before it ships — is there an eval or golden test?",
      "Which prompts/agents have worked, and where do they live so the team can reuse them?",
    ],
  },
  D9: {
    title: "Little scans what AI ships for vulnerabilities or secrets",
    impact: "high",
    effort: "low",
    rationale:
      "AI confidently produces plausible code that can carry vulnerabilities, leaked secrets, or risky dependencies. Automated SAST, dependency/secret scanning, and signed, attested artifacts are the shift-left guardrail that lets you trust an agent's output reaching production.",
    explore: [
      "If an agent pulled in a vulnerable dependency or committed a secret, what would catch it before release?",
      "Can you prove what's in a build and that it wasn't tampered with — SBOM, signing, provenance?",
    ],
  },
};

/** Build a prioritized fallback roadmap, ranked by weighted upside under the archetype. */
export function buildFallbackRoadmap(
  signals: DimensionSignals[],
  overallScore: number,
  archetype: RepoArchetype = "org",
): LlmRoadmapItem[] {
  const current = levelForScore(overallScore);
  // Derive the next level from the canonical LEVELS ordering (as cheapestPathToNextLevel does), not
  // by slicing + incrementing the id string: a top-band repo otherwise yields a self-referential
  // "L5->L5", and a drifted/hand-edited id ("L5b", "") makes Number(...) NaN -> "...->LNaN".
  const curIdx = LEVELS.findIndex((l) => l.id === current.id);
  const nextLevel = curIdx >= 0 && curIdx < LEVELS.length - 1 ? LEVELS[curIdx + 1] : null;
  const unlock = nextLevel ? `${current.id}->${nextLevel.id}` : undefined;
  const w = weightsFor(archetype);

  return [...signals]
    // Skip ids with no catalog/rubric entry (a persisted or future-detector signal) rather
    // than dereferencing CATALOG[s.id].title / DIMENSION_BY_ID[s.id].name and crashing the
    // fallback roadmap. Drift becomes a missing row, never a TypeError.
    .filter((s) => {
      if (CATALOG[s.id] && DIMENSION_BY_ID[s.id]) return true;
      console.warn(`[recommendations] skipped unknown dimension id "${s.id}" (no catalog entry).`);
      return false;
    })
    .map((s) => ({ s, upside: (w[s.id] ?? 0) * (100 - s.signalScore) }))
    .sort((a, b) => b.upside - a.upside)
    .slice(0, 3)
    .map(({ s }) => {
      const t = CATALOG[s.id];
      return {
        title: t.title,
        dimension: s.id,
        impact: t.impact,
        effort: t.effort,
        rationale: `${DIMENSION_BY_ID[s.id].name} scored ${s.signalScore}/100. ${t.rationale}`,
        explore: t.explore,
        levelUnlock: unlock,
      };
    });
}
