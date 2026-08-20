// A deterministic catalog of "next step" recommendations per dimension. Used by the
// MockProvider (keyless demo) and as a fallback when the LLM returns an empty roadmap.
// Steps are ranked by *weighted upside* under the repo's archetype lens, so a solo repo
// is steered toward tooling/tests/docs rather than org-scale CI it doesn't need yet.

import type { DimensionId, DimensionSignals, LlmRoadmapItem, RepoArchetype } from "@/lib/types";
import { DIMENSION_BY_ID, FOLLOW_UP_BELOW, levelForScore, nextLevel, weightsFor } from "@/lib/maturity/model";
import { IMPACT_RANK } from "@/lib/scoring/impact";

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
    title: "Agent guidance is thin: agents have little to go on here",
    impact: "high",
    effort: "low",
    rationale:
      "Substantive, machine-readable guidance (build/test commands, an architecture map, the rules a change must never break) is what lets an AI contribution land consistently and on-spec. A token stub barely moves trust.",
    explore: [
      "What would an AI agent need to know to make a safe change here: commands, architecture, the constraints it must never break?",
      "Where do new contributors (human or AI) get stuck today for lack of written context?",
    ],
  },
  D2: {
    title: "Few tests vouch for behavior: little catches a bad change",
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
    title: "Little gates what reaches main: trust rests on who reviewed",
    impact: "high",
    effort: "low",
    rationale:
      "A CI gate turns guardrails into enforcement, so trust doesn't depend on a particular reviewer: neither humans nor agents can merge a regression past it.",
    explore: [
      "What stops an untrusted change from reaching main today?",
      "Could every PR's checks run automatically, so trust isn't a function of who looked?",
    ],
  },
  D4: {
    title: "AI isn't in the loop yet: it's at most at the keyboard",
    impact: "high",
    effort: "medium",
    rationale:
      "AI review, auto-fix, and evals for generated output are the jump from 'AI at the keyboard' to a pipeline that can trust an agent's first pass.",
    explore: [
      "Where could an agent take the first pass (review, triage, codegen) with a human just confirming?",
      "What would you need in place to trust an agent's output without reading every line?",
    ],
  },
  D5: {
    title: "Sparse docs/ADRs: context lives in people's heads",
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
    title: "AI use is ad hoc: no shared process or harness",
    impact: "high",
    effort: "medium",
    rationale:
      "Evals for generated output, versioned prompts/agents, runbooks, and a review gate turn ad-hoc prompting into a repeatable, trustworthy part of how the team ships.",
    explore: [
      "How do you know an AI-generated change is good before it ships? Is there an eval or golden test?",
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
      "Can you prove what's in a build and that it wasn't tampered with: SBOM, signing, provenance?",
    ],
  },
};

/**
 * How much one step of EFFORT discounts a step's weighted upside in the roadmap ranking: 10% per
 * ordinal, so low = ×1.0, medium = ×0.9, high = ×0.8 (the ordinal is IMPACT_RANK, the repo's single
 * authority for high/medium/low → 3/2/1; effort shares that scale).
 *
 * WHAT IT REPLACED. The key was `weight × headroom` alone — effort was carried to display and never
 * entered the ordering. Two gaps of comparable upside therefore ranked by a coin-flip of rounding,
 * and the first thing a team was told to do could be the most expensive thing on the board. A cheap
 * item and an expensive item with equal upside are not equally "next"; the roadmap is a recommendation
 * about what to do FIRST, and cost is half of that judgment.
 *
 * WHY 10% AND NOT A DIVISION. Dividing by effort (or anything near it) over-rewards trivia and would
 * push a genuinely dominant high-effort gap off a three-item list entirely — the roadmap becomes a
 * chore list and the real problem goes unsaid. At 10%/ordinal the discount only reorders items already
 * within ~20% of each other, which is exactly the "comparable upside" case it is meant to settle; a
 * gap that leads by more than that still leads. The trade-off accepted: two dimensions whose upside
 * differs by under a fifth now rank by cost, which is a deliberate judgment, not a measurement.
 */
const EFFORT_DISCOUNT_PER_RANK = 0.1;

/** Ranking multiplier for a step's effort — low 1.0, medium 0.9, high 0.8. An unknown/absent effort
 *  is treated as `medium` so a drifted catalog value is neither rewarded nor punished. */
function effortFactor(effort: string): number {
  return 1 - EFFORT_DISCOUNT_PER_RANK * ((IMPACT_RANK[effort] ?? IMPACT_RANK.medium!) - 1);
}

/** Build a prioritized fallback roadmap, ranked by weighted upside under the archetype.
 *
 *  `blended` is the report's actual POST-BLEND dimension scores (e.g. engine.ts's `dimensions`), keyed
 *  by id. When supplied, ranking and the rationale text use the blended score — the same number the
 *  report headline and dimension cards show — instead of the pre-blend `signalScore`, which can differ
 *  by up to the LLM guardband (G3-09: a dimension the blend lifted could otherwise be surfaced as the
 *  #1 gap with a rationale citing a number never shown next to it). Omitted (or missing an id) falls
 *  back to that dimension's raw `signalScore`, so existing callers (the mock provider, which has no
 *  separate blend — signalScore IS its score) are unaffected. */
export function buildFallbackRoadmap(
  signals: DimensionSignals[],
  overallScore: number,
  archetype: RepoArchetype = "org",
  blended?: { id: DimensionId; score: number }[],
): LlmRoadmapItem[] {
  const blendedById = new Map((blended ?? []).map((d) => [d.id, d.score]));
  const scoreFor = (s: DimensionSignals) => blendedById.get(s.id) ?? s.signalScore;
  const current = levelForScore(overallScore);
  // Derive the next level from the canonical LEVELS ordering (the shared nextLevel helper, as
  // cheapestPathToNextLevel does), not by slicing + incrementing the id string: a top-band repo
  // otherwise yields a self-referential "L5->L5", and a drifted/hand-edited id ("L5b", "") makes
  // Number(...) NaN -> "...->LNaN".
  const next = nextLevel(current.id);
  const unlock = next ? `${current.id}->${next.id}` : undefined;
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
    // weight × headroom × effort — priority is the product of all three (see EFFORT_DISCOUNT_PER_RANK);
    // ranking on the first two alone recommended the mountain whenever a molehill scored within a
    // rounding error of it.
    .map((s) => ({ s, upside: (w[s.id] ?? 0) * (100 - scoreFor(s)) * effortFactor(CATALOG[s.id].effort) }))
    .sort((a, b) => b.upside - a.upside)
    .slice(0, 3)
    .map(({ s }) => {
      const t = CATALOG[s.id];
      return {
        title: t.title,
        dimension: s.id,
        impact: t.impact,
        effort: t.effort,
        rationale: `${DIMENSION_BY_ID[s.id].name} scored ${scoreFor(s)}/100. ${t.rationale}`,
        explore: t.explore,
        levelUnlock: unlock,
      };
    });
}

/**
 * The follow-up GUARANTEE: every dimension below FOLLOW_UP_BELOW (the L4 floor — the first green
 * band) carries at least one roadmap entry, whether or not the model wrote one.
 *
 * WHY. The prompt asks for 3-5 roadmap entries and there are nine dimensions, so most scans left
 * four to six dimensions with nothing under "Next steps" — including 40s and 50s. The drill-in
 * then said "It isn't a current gap", which certified a mediocre dimension as fine. A reader takes
 * an empty follow-up list as a verdict, so a dimension that is not yet green must never have one.
 *
 * The prompt now asks for full coverage (ROADMAP COVERAGE); this is what makes it a guarantee
 * rather than a request. Ordering: the model's entries stay first, in the model's order — the
 * synthesised ones are appended, lowest score first, so a fully-covered scan is byte-identical to
 * before and a partly-covered one grows at the tail. Each synthesised entry is grounded in the
 * dimension's OWN gaps when the model supplied them (the first gap becomes the title, in the
 * catalog's invitational voice), falling back to the catalog template only when it did not.
 * Pure in its RESULT (the caller supplies the blended scores); its one side effect is the
 * invitational-framing lint, which reports what it finds and changes nothing. Exported for the tests.
 */
export function buildDimensionFollowUps(
  roadmap: LlmRoadmapItem[],
  dimensions: { id: DimensionId; score: number; gaps?: string[] }[],
  overallScore: number,
): LlmRoadmapItem[] {
  const covered = new Set(roadmap.map((r) => r.dimension));
  const current = levelForScore(overallScore);
  const next = nextLevel(current.id);
  const unlock = next ? `${current.id}->${next.id}` : undefined;
  const missing = dimensions
    .filter((d) => d.score < FOLLOW_UP_BELOW && !covered.has(d.id) && CATALOG[d.id] && DIMENSION_BY_ID[d.id])
    .sort((a, b) => a.score - b.score);
  // Framing lint runs HERE because this is the one funnel every roadmap passes through — the model's
  // entries and the synthesised ones alike (engine.ts calls it on both branches). Violations are
  // recorded, never rewritten or dropped; see reportFramingViolations.
  if (missing.length === 0) {
    reportFramingViolations(roadmap);
    return roadmap;
  }
  const out = [
    ...roadmap,
    ...missing.map((d) => {
      const t = CATALOG[d.id];
      const gap = d.gaps?.find((g) => g.trim().length > 0)?.trim();
      return {
        // The scan's own finding, if it made one; the catalog's framing otherwise. Either way an
        // OBSERVATION, never an imperative — the same voice the prompt requires of the model.
        title: gap ?? t.title,
        dimension: d.id,
        impact: t.impact,
        effort: t.effort,
        rationale: `${DIMENSION_BY_ID[d.id].name} scored ${d.score}/100, below the green band (${FOLLOW_UP_BELOW}). ${t.rationale}`,
        explore: t.explore,
        levelUnlock: unlock,
      };
    }),
  ];
  reportFramingViolations(out);
  return out;
}

// ---- Invitational-framing lint ------------------------------------------------------------------
//
// The framing rules for a roadmap entry (an OBSERVATION about a gap in trust, never an order; no
// supervisory voice; a title that does not contradict its own rationale) were written down in the
// assessment prompt and enforced NOWHERE. The hand-reviewed CATALOG above stays compliant because a
// human wrote it; the live-LLM path — the one that produces most of what a reader actually sees —
// had nothing checking it, and the roadmap is precisely the surface where "You must add CI"
// turns a companion into a compliance nag. The cost lands on adoption, not on correctness.
//
// DETERMINISTIC ON PURPOSE. This is a lint, not a second model: a model judging a model's tone adds
// a call, a failure mode, and a non-reproducible verdict to a check that has to run on every scan.
// The rules below are word-level and testable, seeded with the catalog as positive fixtures.
//
// RECORDED, NEVER REWRITTEN. A violation is reported and the entry SHIPS UNCHANGED. Rejecting on
// phrasing would send an otherwise-useful, evidence-grounded roadmap item to the fallback template
// (losing the finding to protect the tone), and silently rewriting a model's sentence would put words
// in its mouth that no longer match the evidence it cited. So the entry stands and the violation is
// observable — the lint's job is to make drift visible, not to launder it.

export type FramingRule = "imperative-title" | "supervisory-tone" | "title-contradicts-rationale";

export interface FramingViolation {
  dimension: string;
  title: string;
  rule: FramingRule;
  /** The phrase that tripped the rule, so the report reads as evidence rather than a verdict. */
  detail: string;
}

// Bare imperative openers: a title starting with one of these is an ORDER ("Add a CI gate"), not the
// observation the roadmap promises ("Little gates what reaches main"). Only the FIRST word is
// checked — "Few tests vouch for behavior" legitimately contains "vouch", and a mid-sentence verb is
// description, not instruction.
const IMPERATIVE_OPENERS = new Set([
  "add", "adopt", "build", "configure", "create", "define", "document", "enable", "enforce",
  "ensure", "establish", "fix", "implement", "improve", "install", "introduce", "make", "migrate",
  "move", "replace", "run", "set", "start", "switch", "update", "use", "write",
]);

// Supervisory voice, checked in title AND rationale: the roadmap reports to the team, it does not
// manage them. Deadline-pressure words are here for the same reason — the scan does not know the
// team's quarter and must never imply it does.
const SUPERVISORY_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\byou (?:must|should|need to|have to|are required to)\b/i, label: "you must/should/need to" },
  { re: /\bmake sure\b/i, label: "make sure" },
  { re: /\bbe sure to\b/i, label: "be sure to" },
  { re: /\bit is (?:mandatory|required)\b/i, label: "it is required/mandatory" },
  { re: /\bfailure to\b/i, label: "failure to" },
  { re: /\b(?:immediately|as soon as possible)\b/i, label: "immediately / as soon as possible" },
];

/** Title vocabulary that asserts a gap — the voice every catalog entry uses. */
const GAP_CLAIM = /\b(?:no|not|n't|few|little|sparse|thin|missing|lacks?|lacking|ad hoc|nothing|rarely|hard to|isn't)\b/i;

/** Rationale vocabulary that asserts the same capability is ALREADY there. Paired with a gap-claiming
 *  title this is a self-contradicting entry: the reader is told a thing is both absent and handled. */
const PRESENCE_CLAIM =
  /\b(?:already (?:in place|covered|handled|enforced|exists)|well[- ]covered|comprehensive coverage|nothing to (?:improve|fix)|no gap here|strong coverage)\b/i;

/**
 * Check roadmap entries against the invitational-framing rules. Pure and allocation-cheap; returns
 * one violation per (entry, rule) so a single badly-framed entry can report every way it drifted.
 * Exported for the tests and for any surface that wants to show the drift rather than only log it.
 */
export function lintRoadmapFraming(items: Pick<LlmRoadmapItem, "title" | "dimension" | "rationale">[]): FramingViolation[] {
  const out: FramingViolation[] = [];
  for (const item of items) {
    const title = item.title ?? "";
    const rationale = item.rationale ?? "";
    const at = (rule: FramingRule, detail: string) =>
      out.push({ dimension: String(item.dimension), title, rule, detail });

    const firstWord = title.trim().split(/[\s,:;.]+/, 1)[0]?.toLowerCase() ?? "";
    if (IMPERATIVE_OPENERS.has(firstWord)) {
      at("imperative-title", `title opens with the imperative "${firstWord}"`);
    }
    for (const { re, label } of SUPERVISORY_PATTERNS) {
      if (re.test(title)) at("supervisory-tone", `title uses supervisory phrasing ("${label}")`);
      else if (re.test(rationale)) at("supervisory-tone", `rationale uses supervisory phrasing ("${label}")`);
    }
    const presence = PRESENCE_CLAIM.exec(rationale);
    if (presence && GAP_CLAIM.test(title)) {
      at("title-contradicts-rationale", `title states a gap while the rationale says "${presence[0]}"`);
    }
  }
  return out;
}

/** Run the lint and record what it found. Console, deliberately: it is the same channel the unknown-
 *  dimension drift warning above uses, it costs nothing on the happy path, and it keeps the entry
 *  itself untouched. Returns the violations so a caller can surface them instead. */
export function reportFramingViolations(items: Pick<LlmRoadmapItem, "title" | "dimension" | "rationale">[]): FramingViolation[] {
  const violations = lintRoadmapFraming(items);
  for (const v of violations) {
    console.warn(`[recommendations] framing violation (${v.rule}) on ${v.dimension}: ${v.detail} — "${v.title}"`);
  }
  return violations;
}
