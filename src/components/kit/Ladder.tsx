// Ladder + CellMark: status without hue. A ladder is an ordered run of steps (tiers, bands, stages); a
// CellMark is one cell of a matrix. Both say their state as a glyph, a word and a lightness (paper = reached,
// outline = current or partial, hairline = open, hatch = not measured), so a dimension's hue is never
// borrowed for status and unknown stays visibly unknown. Server-safe.
import type { ReactNode } from "react";

export type LadderState = "reached" | "current" | "open" | "unmeasured";
export type CellState = "met" | "partial" | "missing" | "unmeasured";

const STEP_GLYPH: Record<LadderState, string> = { reached: "✓", current: "◐", open: "○", unmeasured: "–" };
const STEP_WORD: Record<LadderState, string> = { reached: "reached", current: "current", open: "open", unmeasured: "not measured" };
const CELL_GLYPH: Record<CellState, string> = { met: "✓", partial: "◐", missing: "✕", unmeasured: "–" };
const CELL_WORD: Record<CellState, string> = { met: "met", partial: "partial", missing: "missing", unmeasured: "not measured" };

export interface LadderStep {
  key: string;
  label: ReactNode;
  state: LadderState;
  detail?: ReactNode;
}

export function Ladder({ steps, label, className = "" }: { steps: LadderStep[]; label: string; className?: string }) {
  return (
    <ol data-kit="ladder" data-role="ladder" aria-label={label} className={`grid gap-px sm:grid-flow-col sm:auto-cols-fr ${className}`.trim()}>
      {steps.map((s) => (
        <li
          key={s.key}
          data-role="ladder-step"
          data-state={s.state}
          aria-current={s.state === "current" ? "step" : undefined}
          className="min-w-0 border-t-2 border-divider px-3 py-2"
        >
          <span data-role="ladder-state" className="type-note text-slate-400">
            <span aria-hidden>{STEP_GLYPH[s.state]} </span>
            {STEP_WORD[s.state]}
          </span>
          <span data-role="ladder-label" className="block truncate type-body-sm font-medium text-white">
            {s.label}
          </span>
          {s.detail != null && <span className="block type-note text-slate-400">{s.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

export function CellMark({ state, children, className = "" }: { state: CellState; children?: ReactNode; className?: string }) {
  return (
    <span data-kit="cell-mark" data-role="cell-mark" data-state={state} className={`inline-flex items-center gap-1.5 type-body-sm ${className}`.trim()}>
      <span aria-hidden data-role="cell-glyph">
        {CELL_GLYPH[state]}
      </span>
      <span data-role="cell-word">{children ?? CELL_WORD[state]}</span>
    </span>
  );
}
