// Deepens a divergent/gap dimension into an actionable, STRUCTURAL transformation playbook for an IT
// leader distributing knowledge across teams: the change types (culture/skills/practice), an ordered
// set of MOVES specific to what that capability actually is (testing gates, review norms, agent-ready
// hand-offs …) but kept high-level — never an implementation ("a testing culture", not "add vitest").
// Plus a proposed Practices artifact and an adoption checklist to own as a goal in Plan. Pure +
// unit-tested (transferPlaybook.test.ts). See fleetAnalysis.ts for the diagnosis it builds on.

import type { DimInsight } from "@/components/org/fleet/tech-stacks/fleetAnalysis";

export type ChangeType = "culture" | "skills" | "practice";

export interface Playbook {
  changeTypes: ChangeType[];
  /** One-line structural framing of the move. */
  summary: string;
  /** Ordered, dimension-specific structural steps (the last is the goal). */
  steps: string[];
  /** The deliverable the Practices module would generate. */
  artifact: { name: string; kind: string };
  /** Adoption milestones to hand to the responsible owner as a goal in Plan. */
  checklist: string[];
  /** Score to aim the laggard/fleet toward. */
  target: number;
}

interface DimSpec {
  types: ChangeType[];
  summary: string;
  artifact: { name: string; kind: string };
  /** What a from-scratch build should establish (the gap case, no internal leader). */
  buildFocus: string;
  /** The three capability-specific transfer moves, parameterized by leader / laggard. */
  moves: (leader: string, laggard: string) => string[];
}

// Per-dimension framing. The moves name the actual substance of the capability (what "good" looks
// like for THIS dimension) so they read as concrete guidance, while staying above implementation.
const DIM: Record<string, DimSpec> = {
  D1: {
    types: ["skills", "culture"],
    summary: "spread AI-assisted development from a few champions to the whole team",
    artifact: { name: "AI-assisted dev enablement guide", kind: "guide" },
    buildFocus: "which assistants and agent-instruction conventions the team should standardize on",
    moves: (L, G) => [
      `Document how ${L} works AI-first day-to-day: assistant use, agent-instruction files, and the review habits around them.`,
      `Have ${G} adopt those conventions so AI-assisted work becomes the default, not a few champions'.`,
      `Run a short enablement session for ${G}, then track how widely it's actually used.`,
    ],
  },
  D2: {
    types: ["practice", "culture"],
    summary: "make automated testing a shared team norm, not an afterthought",
    artifact: { name: "Testing standards playbook", kind: "playbook" },
    buildFocus: "what to test, what to gate on merge, and how to cover critical paths",
    moves: (L, G) => [
      `Capture ${L}'s testing bar: what they gate on merge and how they cover critical paths.`,
      `Have ${G} add tests to its highest-risk areas first, pairing with ${L} to learn the approach.`,
      `Make "tests land with the change" a review expectation in ${G}, then track critical-path coverage.`,
    ],
  },
  D3: {
    types: ["practice"],
    summary: "adopt a consistent delivery-pipeline discipline and merge gates",
    artifact: { name: "Delivery pipeline standard", kind: "standard" },
    buildFocus: "which checks gate a merge and how releases are promoted",
    moves: (L, G) => [
      `Map ${L}'s delivery pipeline: the checks that gate a merge and how releases flow.`,
      `Have ${G} adopt the same required checks and promotion steps as a team standard.`,
      `Make a green pipeline before merge non-negotiable in ${G}, then track adherence.`,
    ],
  },
  D4: {
    types: ["skills", "culture"],
    summary: "grow agent-ready workflows and the skills to operate them",
    artifact: { name: "Agent workflow playbook", kind: "playbook" },
    buildFocus: "how to structure work so agents can pick it up and self-verify",
    moves: (L, G) => [
      `Capture how ${L} makes work agent-ready: task breakdowns, context files, and self-verify loops.`,
      `Have ${G} structure its repos and workflows the same way, pairing with ${L}.`,
      `Make agent-ready hand-offs a working norm in ${G}, then track readiness.`,
    ],
  },
  D5: {
    types: ["practice", "culture"],
    summary: "treat documentation as a first-class, maintained habit",
    artifact: { name: "Documentation guidelines", kind: "guide" },
    buildFocus: "what must stay documented: onboarding, architecture, decisions",
    moves: (L, G) => [
      `Identify what ${L} keeps documented and current: onboarding, architecture, and decisions.`,
      `Have ${G} close its biggest documentation gaps first, with ${L} sharing their upkeep habits.`,
      `Make "docs updated with the change" a review expectation in ${G}, then track freshness.`,
    ],
  },
  D6: {
    types: ["practice"],
    summary: "raise the code-quality bar through shared review norms",
    artifact: { name: "Code review standard", kind: "standard" },
    buildFocus: "what a review looks for and the standards it holds",
    moves: (L, G) => [
      `Capture ${L}'s review norms: what a review looks for and the standards it holds.`,
      `Have ${G} adopt those standards and rotate reviewers with ${L} to calibrate.`,
      `Make the quality bar explicit in ${G}'s reviews, then track adherence.`,
    ],
  },
  D7: {
    types: ["culture"],
    summary: "adopt the commit hygiene and collaboration cadence",
    artifact: { name: "Commit & collaboration guide", kind: "guide" },
    buildFocus: "a healthy change size, message quality, and review cadence",
    moves: (L, G) => [
      `Capture ${L}'s commit and collaboration cadence: small changes, clear messages, steady flow.`,
      `Have ${G} adopt the same commit hygiene and PR sizing, coached by ${L}.`,
      `Make the cadence a team habit in ${G}, then track it.`,
    ],
  },
  D8: {
    types: ["culture", "skills"],
    summary: "embed AI in the engineering process: planning, review, retros",
    artifact: { name: "AI-in-process playbook", kind: "playbook" },
    buildFocus: "where AI should assist across the process, not just coding",
    moves: (L, G) => [
      `Document where ${L} uses AI across the process: planning, review, and retros, not just coding.`,
      `Have ${G} fold AI into the same process points, learning ${L}'s prompts and checkpoints.`,
      `Make AI-in-process a standing practice in ${G}, then track uptake.`,
    ],
  },
  D9: {
    types: ["practice", "skills"],
    summary: "build security practices and awareness into everyday work",
    artifact: { name: "Security practices baseline", kind: "standard" },
    buildFocus: "what to scan, what to review, and what should never ship",
    moves: (L, G) => [
      `Capture ${L}'s security habits: what they scan for, review, and treat as non-negotiable.`,
      `Have ${G} adopt those practices, starting with its highest-risk surfaces and guided by ${L}.`,
      `Make security checks a review norm in ${G}, then track coverage.`,
    ],
  },
};

const FALLBACK: DimSpec = {
  types: ["practice"],
  summary: "adopt the leading stack's practices in this area",
  artifact: { name: "Practice playbook", kind: "playbook" },
  buildFocus: "the practices and standards this capability needs",
  moves: (L, G) => [
    `Have ${L} document the practices behind their strength in this area.`,
    `Have ${G} adopt them, pairing with ${L} to transfer the know-how.`,
    `Make them a review norm in ${G}, then track adoption.`,
  ],
};

// Fleet maturity floor a systemic gap should be built toward (no internal leader to emulate).
const GAP_TARGET = 60;

/** Build the transformation playbook for a move. Divergent = a leader→laggard transfer aimed at the
 *  leader's score; a gap has no internal model, so it becomes a fleet-wide build to the maturity floor. */
export function buildPlaybook(d: DimInsight): Playbook {
  const spec = DIM[d.dimId] ?? FALLBACK;
  const { leader, laggard } = d;

  if (d.klass === "gap") {
    const target = GAP_TARGET;
    return {
      changeTypes: spec.types,
      summary: spec.summary,
      target,
      steps: [
        `No internal leader on ${d.label}: even ${leader.name} only reaches ${leader.value}, so treat it as a fleet-wide build.`,
        `Establish a baseline of ${spec.buildFocus}, starting with the highest-risk areas.`,
        `Pilot it on one stack, then adopt it as a review norm everywhere.`,
        `Set a fleet goal to lift ${d.label} above ${target}, with an owner and a cadence.`,
      ],
      artifact: spec.artifact,
      checklist: [
        `Owner named for ${d.label}`,
        `Baseline ${d.label} standard drafted`,
        `Piloted on one stack`,
        `Adopted as a review norm fleet-wide`,
        `Fleet ${d.label} above ${target}`,
      ],
    };
  }

  const target = leader.value;
  return {
    changeTypes: spec.types,
    summary: spec.summary,
    target,
    steps: [
      ...spec.moves(leader.name, laggard.name),
      `Set a goal to bring ${laggard.name} from ${laggard.value} toward ${target}, with an owner and a cadence.`,
    ],
    artifact: spec.artifact,
    checklist: [
      `Owner named in ${laggard.name}`,
      `${d.label} standard drafted from ${leader.name}'s practice`,
      `${leader.name} ↔ ${laggard.name} guild / pairing running`,
      `Standard adopted as a review norm`,
      `${laggard.name} ${d.label} reaches ≥ ${target}`,
    ],
  };
}
