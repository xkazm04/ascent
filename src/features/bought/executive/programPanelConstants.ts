// Shared labels and input classes for the transition-programme control — used by both halves of the
// panel (the read view in ProgramPanelSummary.tsx and the form in ProgramPanel.tsx). Split out for the
// 200-line cap; data only, no JSX.

import type { ProgramCadence } from "@/lib/db/org-program";

export const CADENCE_LABEL: Record<ProgramCadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
};

/**
 * (D) The frozen-origin contract, demoted out of the panel header and onto a WhyChip beside the
 * drawing that now shows it. The mark carries the mechanism; this sentence is why the mark is a ring
 * rather than a dot, and it is reachable on hover/focus instead of sitting above the panel forever.
 */
export const PROGRAM_ORIGIN_HINT =
  "The programme's baseline is frozen the moment it starts and is never recomputed, so every later number is measured against a fixed origin. Re-targeting moves the rung it is steering at and leaves the origin exactly where it is.";

export const inputClass =
  "w-full rounded-md border border-divider bg-ink px-3 py-2 type-body-sm text-white placeholder:text-slate-600 focus-ring";
export const labelClass = "block type-label tracking-[0.14em] text-slate-500";
