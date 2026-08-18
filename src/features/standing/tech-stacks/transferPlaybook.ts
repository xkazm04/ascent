// Deepens a divergent/gap dimension into an actionable, STRUCTURAL transformation playbook for an IT
// leader distributing knowledge across teams: the change types (culture/skills/practice), an ordered
// set of MOVES specific to what that capability actually is (testing gates, review norms, agent-ready
// hand-offs …) but kept high-level — never an implementation ("a testing culture", not "add vitest").
// Plus a proposed Practices artifact and an adoption checklist to own as a goal in Plan. Pure +
// unit-tested (transferPlaybook.test.ts). See fleetAnalysis.ts for the diagnosis it builds on.
//
// The per-dimension framing (DimSpec / DIM / FALLBACK) lives in transferPlaybookDims.ts for the
// 200-LOC cap; this file keeps the shape and the assembly.

import type { DimInsight } from "@/features/standing/tech-stacks/fleetAnalysis";
import { DIM, FALLBACK } from "./transferPlaybookDims";

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
