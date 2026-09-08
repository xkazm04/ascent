// What the week did to the follow-up ledger, drawn on one count axis.
//
// THE SENTENCE THIS DRAWING EXISTS TO STOP NEEDING — *"What the ledger closed, and what the latest
// scans opened. Dismissals are counted beside the closes, never folded into them."* "Beside, never
// folded into" is a promise in prose and a SEGMENT in a picture: the dismissed block sits after a
// visible gap, outside the closed block, wearing the kit's `decided` accent ring because a dismissal
// is a person deciding the work will not be done. Nothing can quietly add it to the closes, because
// the two are different marks on the same axis.
//
// The second half is the asymmetry between the columns. "Closed" is an event, so it always has a
// count. "Opened" is a derived diff against each repo's pre-window scan, so with no repo scanned
// before the window it has NO count — drawn as a void, with `rendersValue("missing") === false`
// making the 0 that would read as "a calm week" unprintable.
//
// Server-safe, no motion. Colour is the sanctioned direction triad (DIRECTION_TONE), never a hand
// -picked hex: closing follow-ups is the rising direction, opening them the falling one.

import { DIRECTION_TONE } from "@/components/org/shared/ui";
import {
  STATE_LABEL,
  VOID_DASH,
  isNum,
  r2,
  rendersValue,
  stateFill,
  stateStroke,
  stateStrokeWidth,
  stateTitle,
} from "@/components/org/viz";
import type { LedgerBar, LedgerView } from "./digestViz";

const LABEL_W = 62;
const TRACK_W = 234;
const W = LABEL_W + TRACK_W;
const ROW_H = 24;
const BAR_H = 12;
const GAP = 3; // the visible separation that makes "beside, never folded into" a fact of the drawing
const H = ROW_H * 2 + 12;

const CLOSED_HEX = DIRECTION_TONE.rising.color;
const OPENED_HEX = DIRECTION_TONE.falling.color;

const wOf = (n: number, max: number) => r2(Math.max(n > 0 ? 2 : 0, (n / max) * TRACK_W));

function Seg({ bar, x, y, max, base }: { bar: LedgerBar; x: number; y: number; max: number; base: string }) {
  if (!isNum(bar.count) || bar.count === 0) return null;
  const w = wOf(bar.count, max);
  return (
    <g data-seg={bar.id} data-state={bar.state}>
      <rect
        x={r2(x)}
        y={y}
        width={w}
        height={BAR_H}
        rx={2}
        fill={stateFill(bar.state, base)}
        fillOpacity={bar.state === "decided" ? 0.35 : 0.85}
        stroke={stateStroke(bar.state, base)}
        strokeWidth={stateStrokeWidth(bar.state)}
      />
      <title>{`${bar.label}: ${bar.count}. ${bar.state === "decided" ? "Counted beside the closes, never folded into them — a dismissal is a decision not to do the work." : "Status changes recorded inside the window."}`}</title>
    </g>
  );
}

export function DigestLedgerBars({ view }: { view: LedgerView }) {
  const { closed, dismissed, opened, max } = view;
  const dismissedX = LABEL_W + wOf(closed.count ?? 0, max) + GAP;
  const openedCount = opened.count;

  const ariaLabel =
    `Follow-up ledger this week, on one count axis. Closed ${closed.count}. ` +
    `Dismissed ${dismissed.count}, counted beside the closes and never folded into them. ` +
    (isNum(openedCount)
      ? `Opened ${openedCount}.`
      : "Opened: no measurement — no repository had a scan from before the window to diff against, so this is not a zero.");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>

        <text x={0} y={ROW_H / 2 + 3} fontSize={8.5} className="fill-slate-400 font-mono uppercase tracking-[0.14em]">
          closed
        </text>
        <line x1={LABEL_W} y1={2} x2={LABEL_W} y2={ROW_H * 2} stroke="var(--color-divider)" strokeWidth={1} />
        <Seg bar={closed} x={LABEL_W} y={(ROW_H - BAR_H) / 2} max={max} base={CLOSED_HEX} />
        <Seg bar={dismissed} x={dismissedX} y={(ROW_H - BAR_H) / 2} max={max} base="var(--color-divider)" />

        <text x={0} y={ROW_H + ROW_H / 2 + 3} fontSize={8.5} className="fill-slate-400 font-mono uppercase tracking-[0.14em]">
          opened
        </text>
        {isNum(openedCount) ? (
          <Seg bar={opened} x={LABEL_W} y={ROW_H + (ROW_H - BAR_H) / 2} max={max} base={OPENED_HEX} />
        ) : (
          <g data-seg="opened" data-state="missing">
            <line
              data-void
              x1={LABEL_W + 2}
              y1={ROW_H + ROW_H / 2}
              x2={W - 2}
              y2={ROW_H + ROW_H / 2}
              stroke="var(--color-divider)"
              strokeWidth={1}
              strokeDasharray={VOID_DASH}
            />
            <text x={LABEL_W + 6} y={ROW_H + ROW_H / 2 - 5} fontSize={8} className="fill-slate-500 font-mono uppercase tracking-[0.14em]">
              {STATE_LABEL.missing}
            </text>
            <title>{stateTitle("missing", "Follow-ups opened this week")}</title>
          </g>
        )}

        {/* the axis both tracks are drawn on, so the two bars are comparable rather than each self-scaled */}
        <line x1={LABEL_W} y1={ROW_H * 2} x2={W} y2={ROW_H * 2} stroke="var(--color-divider)" strokeWidth={1} />
        <text x={W} y={H - 2} textAnchor="end" fontSize={7} className="fill-slate-600 font-mono tabular-nums">
          {max}
        </text>
      </svg>

      <table className="sr-only">
        <caption>Follow-up ledger this week</caption>
        <tbody>
          {[closed, dismissed, opened].map((b) => (
            <tr key={b.id}>
              <th scope="row">{b.label}</th>
              <td>{rendersValue(b.state) && isNum(b.count) ? b.count : STATE_LABEL[b.state]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
