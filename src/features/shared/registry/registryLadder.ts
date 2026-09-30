// Prism reading of the six registry steps. The state machine stays in registrySteps.
// Ladder has no skipped, blocked, or multi-current state, so the v1 word travels as detail
// and only the first active or blocked step is current.

import type { CellState, LadderState, LadderStep } from "@/components/kit";
import type { MigrationStep, RegistryView } from "@/lib/org/registry-view";
import { registrySteps, type RegistryStep, type StepState } from "./registryModel";

export const STEP_READ: Record<StepState, string> = {
  done: "done",
  active: "next",
  blocked: "blocked",
  pending: "waiting",
  skipped: "n/a",
};

function ladderState(steps: readonly RegistryStep[], step: RegistryStep): LadderState {
  if (step.state === "done") return "reached";
  const lead = steps.find((s) => s.state === "active" || s.state === "blocked");
  if (lead?.id === step.id) return "current";
  return "open";
}

export function ladderSteps(view: RegistryView): LadderStep[] {
  const steps = registrySteps(view);
  return steps.map((s) => ({
    key: s.id,
    label: s.title,
    state: ladderState(steps, s),
    detail: STEP_READ[s.state],
  }));
}

export function migrationMark(state: MigrationStep["state"]): { state: CellState; word: string } {
  switch (state) {
    case "merged":
      return { state: "met", word: "merged" };
    case "pr-open":
      return { state: "partial", word: "PR open" };
    case "not-started":
      return { state: "missing", word: "not started" };
    case "n/a":
      return { state: "unmeasured", word: "hosted" };
  }
}

/** The affordances the v1 stepper drew inline. Migrate stays on the artifact frame. */
export function stepHasAction(view: RegistryView, step: RegistryStep): boolean {
  if (step.id === "choose" && step.state === "active") return true;
  if (step.id === "permissions" && step.state === "blocked" && !!view.capabilities.installUrl) return true;
  if (step.id === "scaffold" && step.state === "active" && !!view.scaffoldPrUrl) return true;
  if (step.id === "point" && step.state === "active") return true;
  return false;
}
