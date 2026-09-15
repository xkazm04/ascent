// The shape that carries a fitted trend's headline reading: a short segment drawn at the fit's own
// angle. It is the first thing under the "Delivery over time" header, so the panel opens on a
// picture of which way the controls are moving rather than on a sentence about it (§2.2).
//
// The other half is why it exists at all. A fit below the shared insufficiency floor used to print
// its refusal as a sentence next to the confident fits, in the same type, and a reader scanning six
// readouts absorbed six trends. Below the floor the mark is now HATCHED and carries NO numeral —
// `rendersValue("not-judged")` is false, and that is the whole point: "not judged, never as passing"
// is enforced by the drawing instead of asserted beside it.
//
// Server-safe: no hooks, no handlers.

import { r2 } from "@/components/report/svgCoord";
import {
  HATCH_ID,
  VizDefs,
  rendersValue,
  stateStroke,
  stateTitle,
  type VizState,
} from "@/components/org/viz";

const W = 46;
const H = 20;
const MID = H / 2;
const REACH = 7; // max vertical deflection of either end, in user units

export function DeliverySlopeMark({
  perWeek,
  state,
  subject,
  color,
  /** The slope magnitude that saturates the mark's angle, in the fit's own unit per week. */
  ref = 4,
}: {
  perWeek: number;
  state: VizState;
  /** Noun phrase naming the fit — becomes the accessible name and the `<title>`. */
  subject: string;
  color?: string;
  ref?: number;
}) {
  const judged = rendersValue(state);
  const norm = ref > 0 ? Math.max(-1, Math.min(1, perWeek / ref)) : 0;
  const d = r2(norm * REACH);
  const title = stateTitle(state, judged ? `${subject}: ${perWeek > 0 ? "+" : ""}${perWeek} per week` : subject);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="shrink-0" role="img" aria-label={title}>
      <title>{title}</title>
      {!judged && <VizDefs />}
      {/* the zero reference — a flat slope has somewhere to be flat against */}
      <line x1={0} x2={W} y1={MID} y2={MID} stroke="var(--color-divider)" strokeWidth={1} strokeDasharray="2 3" />
      {judged ? (
        <line
          data-slope
          x1={2}
          y1={r2(MID + d)}
          x2={W - 2}
          y2={r2(MID - d)}
          stroke={stateStroke(state, color)}
          strokeWidth={2}
          strokeLinecap="round"
        />
      ) : (
        // Not judged: the hatch fills the slot the slope would have occupied, so the reader sees an
        // answer withheld rather than an absence they might read as "flat".
        <rect data-hatch x={2} y={2} width={W - 4} height={H - 4} rx={3} fill={`url(#${HATCH_ID})`} stroke="var(--color-divider)" strokeWidth={1} />
      )}
    </svg>
  );
}
