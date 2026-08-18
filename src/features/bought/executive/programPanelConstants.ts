// Shared labels and input classes for the transition-programme control — used by both halves of the
// panel (the read view in ProgramPanelSummary.tsx and the form in ProgramPanel.tsx). Split out for the
// 200-line cap; data only, no JSX.

import type { ProgramCadence } from "@/lib/db/org-program";

export const CADENCE_LABEL: Record<ProgramCadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
};

export const inputClass =
  "w-full rounded-md border border-divider bg-ink px-3 py-2 text-sm text-white placeholder:text-slate-600 focus-ring";
export const labelClass = "block font-mono text-xs uppercase tracking-[0.14em] text-slate-500";
