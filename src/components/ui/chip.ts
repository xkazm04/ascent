// The "action chip" — the small bordered toolbar button/anchor used beside CopyForLlm in header
// rows (Download PDF, Share link, skill Download, and CopyForLlm itself). The class string had been
// hand-copied at five sites and CopyForLlm mixed raw palette values (emerald-500/emerald-300) with
// semantic tokens for its states, so adjacent chips could drift on any tweak and a theme palette
// change would leave stale greens behind (pdf-llm-export #5). One definition, semantic tokens only:
// `success` (#10b981/#6ee7b7 — byte-identical to the old emerald-500/emerald-300) and `danger`.
//
// NOT unified here: ReportHeader/FreshnessControl use the separate rounded-full `pillClass`
// (components/report/pill.ts) — a deliberately different, already-single-sourced shape.

export type ChipState = "idle" | "success" | "danger";

const CHIP_BASE =
  "focus-ring inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition";

const CHIP_STATE: Record<ChipState, string> = {
  idle: "border-slate-700 text-slate-300 hover:border-accent hover:text-white",
  success: "border-success/50 bg-success/10 text-success-soft",
  danger: "border-danger/50 text-danger",
};

/** Class string for an action chip; append caller-specific extras (e.g. `disabled:opacity-50`). */
export function chipButtonClass(state: ChipState = "idle", extra = ""): string {
  return [CHIP_BASE, CHIP_STATE[state], extra].filter(Boolean).join(" ");
}
