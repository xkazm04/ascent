// One round's column on the flight log: closes above the axis, reported $ below (a dashed box when the
// round reported NO cost — never a zero bar that reads as $0), the lift triangle, one verdict mark per
// lane. Pure SVG, no hooks.

import { verdictKey } from "./deskFormat";
import { FLOG, type FlogGeo } from "./flogModel";
import type { DeskRound } from "./roundsModel";
import r from "./deskRounds.module.css";

export const MARK: Record<string, string> = { verified: "#37cf8c", rejected: "#ff5f5f", baseline: "#f3b23a", skipped: "#8a94ab" };

export function RoundColumn({ round, i, g, sel }: { round: DeskRound; i: number; g: FlogGeo; sel: boolean }) {
  const cx = g.x(i);
  const { bw, axis, bottom } = g;
  const top = FLOG.top;
  const half = bw / 2;
  return (
    <g className={`${r.rnd} ${sel ? r.sel : ""}`} data-i={i} data-testid="desk-flog-round">
      <rect className={r.hit} x={cx - g.step / 2} y={top - 8} width={g.step} height={bottom - top - 14} rx={3} />
      {round.closes > 0 ? <rect x={cx - half} y={g.yC(round.closes)} width={bw} height={axis - g.yC(round.closes)} rx={1.5} fill="#37cf8c" /> : null}
      {round.costMicros != null && round.costMicros > 0 ? (
        <rect x={cx - half} y={axis + 1} width={bw} height={Math.max(2, g.yK(round.costMicros) - axis)} rx={1.5} fill="#4d9dff" fillOpacity={round.costUnknown ? 0.5 : 1} />
      ) : round.costMicros == null ? (
        <rect x={cx - half + 0.5} y={axis + 3} width={bw - 1} height={9} fill="none" stroke="#56617a" strokeDasharray="2 2" />
      ) : null}
      {round.lift != null && round.lift !== 0 ? <Lift cx={cx} y={(round.closes ? g.yC(round.closes) : axis) - 6} up={round.lift > 0} /> : null}
      {round.lanes.map((l, j) => {
        const cy = g.dotTop + j * FLOG.dotGap;
        if (l.errored)
          return <path key={l.id} d={`M${cx - 4},${cy - 4} L${cx + 4},${cy + 4} M${cx + 4},${cy - 4} L${cx - 4},${cy + 4}`} stroke="#ff5f5f" strokeWidth={1.8} />;
        const k = verdictKey(l.verdict);
        if (k === "unknown") return <circle key={l.id} cx={cx} cy={cy} r={3.6} fill="none" stroke="#6b7892" strokeWidth={1.4} />;
        return <circle key={l.id} cx={cx} cy={cy} r={4.2} fill={MARK[k]} />;
      })}
    </g>
  );
}

function Lift({ cx, y, up }: { cx: number; y: number; up: boolean }) {
  const d = up ? `M${cx - 5},${y} L${cx + 5},${y} L${cx},${y - 7}Z` : `M${cx - 5},${y - 7} L${cx + 5},${y - 7} L${cx},${y}Z`;
  return <path d={d} fill={up ? "#37cf8c" : "#ff5f5f"} />;
}
