// The Knowledge base's legend — where the tab's TWO axes are taught as one mark.
//
// Eleven domain states, six epistemic states. The mark shows both at once: the kit's real
// `StateSwatch` paints the epistemic reading (solid / dashed outline / hatch / void), and the domain
// glyph rides on top to say WHICH of the eleven classifications earned it. The swatch is the same
// element the kit draws elsewhere on the dashboard, so the Knowledge base, Memory and Practices tabs
// cannot drift into three dialects of "not judged".
//
// Both sentences behind each row are disclosed, never printed: the kit's canonical `STATE_HINT` for
// the encoding, and this tab's `CELL_REASON` for why this state classifies the way it does.
//
// Server-safe: `Legend` and `StateSwatch` are server components; nothing here holds state.

import { Legend, STATE_HINT, StateSwatch } from "@/components/org/viz";
import type { KnowledgeCellState } from "@/lib/org/knowledge-shape";
import { ABSENCE_STATES, CELL_REASON, CELL_VIZ_STATE, STATE_GLYPH, STATE_LABEL, VERDICT_STATES } from "./knowledgeModel";

/**
 * One cell state as a mark: the kit's swatch for the epistemic state, the domain glyph over it.
 * `aria-hidden` on the glyph — the swatch already carries the accessible name, and the row's label
 * carries the domain state, so a screen reader would otherwise hear the vocabulary twice.
 */
export function KnowledgeStateMark({ state, size = 14 }: { state: KnowledgeCellState; size?: number }) {
  const glyph = STATE_GLYPH[state];
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <StateSwatch state={CELL_VIZ_STATE[state]} size={size} />
      {glyph ? (
        <span aria-hidden className="absolute inset-0 grid place-items-center font-mono type-micro leading-none text-slate-300">
          {glyph}
        </span>
      ) : null}
    </span>
  );
}

const legendRow = (s: KnowledgeCellState) => ({
  id: s,
  label: STATE_LABEL[s],
  swatch: <KnowledgeStateMark state={s} />,
  hint: `${STATE_HINT[CELL_VIZ_STATE[s]]} ${CELL_REASON[s]}`,
});

/** Verdicts on one line, absences on the next — two halves of one vocabulary, never mixed. */
export function StateLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-1 type-caption text-slate-500">
      <div className="flex flex-wrap items-center gap-x-3">
        <span className="text-slate-600">verdicts</span>
        <Legend extra={VERDICT_STATES.map(legendRow)} />
      </div>
      {compact ? null : (
        <div className="flex flex-wrap items-center gap-x-3">
          <span className="text-slate-600">absences</span>
          <Legend extra={ABSENCE_STATES.map(legendRow)} />
        </div>
      )}
    </div>
  );
}
