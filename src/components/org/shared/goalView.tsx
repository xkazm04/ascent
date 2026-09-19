// Shared, server-safe pace chip and re-exports for maturity-goal presentation.
//
// WHAT IS ACTUALLY MOUNTED. Only `PaceChip` and the re-exported types/helpers have call sites —
// the live wall's goal banner and TV stages. `GoalCard` (overview surface and Plan tab GoalsPanel)
// retired 2026-08-17 with its `initiatives` block; it is deleted, not unmounted. Do not read this
// barrel as evidence a goals management surface exists.
//
// Types live in GoalViewTypes.ts, pure pace/readout logic in goalViewLogic.ts — both re-exported below
// so every existing import of "@/components/org/shared/goalView" keeps resolving unchanged.
import { GOAL_PACE_TONE } from "./goalViewLogic";
import type { GoalProgressView } from "./GoalViewTypes";

export type { GoalProgressView, LinkedInitiative } from "./GoalViewTypes";
export { GOAL_PACE_TONE, GOAL_ATTAINMENT_MARKER, goalBasisMarker, goalMeterAriaLabel } from "./goalViewLogic";

export function PaceChip({ pace }: { pace: GoalProgressView["pace"] }) {
  const p = GOAL_PACE_TONE[pace];
  return (
    <span
      className="shrink-0 rounded-full border px-2 py-0.5 type-mono-sm uppercase tracking-widest"
      style={{ borderColor: `${p.color}66`, color: p.color }}
    >
      {p.label}
    </span>
  );
}
