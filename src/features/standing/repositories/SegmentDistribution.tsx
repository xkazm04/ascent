// A segment comparison as two POPULATIONS on one track — one small mark per repo, the mean marked on
// the same track and labelled as a mean, with the n it rests on printed beside it.
//
// SegmentDumbbell (beside this file) draws the same rows as two dots, which is the honest drawing of
// two MEANS and the only drawing the producer's data supported until `SegmentSummary.points` landed
// (2026-10-05). A mean alone cannot say whether a 14-point gap is the whole slice or one repo dragging
// three, so a reader had to leave the tab to find out. The two live side by side on purpose: the
// dumbbell answers "which side leads and by how much", this answers "what is each side made of".
//
// The two registry rules this obeys, both from `peer-benchmarking`:
//   population-vs-scalar-ranking — a mean and an item are never the same mark. The mean is a ringed
//     mark with the number printed; items are thin ticks and carry no printed figure.
//   basis-disclosure — every side prints the n it drew on, and a one-repo side says it is one repo
//     rather than offering a "segment mean" of itself (`DistSide.basis`, segmentViz.ts).
// And `measurement-honesty`: a side with nothing measured draws NO mark and prints NO number — the gap
// is said in words ("no scanned repository") in the visible label and in the accessible name alike.
//
// Server-safe: no hooks, no handlers, no motion. Colour is scoreHex (the level ramp these numbers are)
// plus CSS tokens — no hand-picked hex (BRAND.md).

import { Kicker } from "@/components/ui";
import { KICKER_SVG_CLASS, r2 } from "@/components/org/viz";
import { scoreHex } from "@/lib/ui";
import { capItems, type DistSide, type DistributionRow } from "./segmentViz";

const W = 320;
const LABEL_W = 70;
const VALUE_W = 30;
const TRACK_L = LABEL_W;
const TRACK_W = W - LABEL_W - VALUE_W;
const SIDE_H = 20;
/** Past this, marks smear instead of shaping. The tail is counted, not drawn (capItems). */
const MAX_MARKS = 36;

const x = (v: number) => r2(TRACK_L + (Math.max(0, Math.min(100, v)) / 100) * TRACK_W);

function SideTrack({ s, y, filled }: { s: DistSide; y: number; filled: boolean }) {
  const { shown, hidden } = capItems(s, MAX_MARKS);
  return (
    <g data-side={filled ? "a" : "b"}>
      <line x1={TRACK_L} y1={y} x2={TRACK_L + TRACK_W} y2={y} stroke="var(--color-divider)" strokeWidth={1} strokeOpacity={0.6} />
      {/* The population: one thin tick per repo, no printed figure — an item is not a mean. */}
      {shown.map((it) => (
        <line
          key={it.fullName}
          data-item={it.fullName}
          x1={x(it.value)}
          y1={y - 5}
          x2={x(it.value)}
          y2={y + 5}
          stroke={scoreHex(it.value)}
          strokeWidth={1.5}
          strokeOpacity={0.75}
        >
          <title>{`${it.fullName} · ${Math.round(it.value)}`}</title>
        </line>
      ))}
      {/* The mean: a ringed mark, visibly a different KIND of mark, with the number printed. Absent
          when there is nothing to average — never floored to 0. */}
      {s.mean != null && (
        <>
          <circle
            data-mean
            cx={x(s.mean)}
            cy={y}
            r={4.5}
            fill={filled ? scoreHex(s.mean) : "var(--color-surface-strong)"}
            stroke={scoreHex(s.mean)}
            strokeWidth={1.5}
          >
            <title>{`${s.name} · mean ${Math.round(s.mean)}, ${s.basis}`}</title>
          </circle>
          <text x={W} y={y + 3} textAnchor="end" fontSize={9} className="font-mono tabular-nums" fill={scoreHex(s.mean)}>
            {Math.round(s.mean)}
          </text>
        </>
      )}
      {s.mean == null && (
        <text x={W} y={y + 3} textAnchor="end" fontSize={9} className="fill-slate-600 font-mono">
          —
        </text>
      )}
      <text x={0} y={y + 3} fontSize={8} className={KICKER_SVG_CLASS}>
        {s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name}
      </text>
      {hidden > 0 && (
        <text x={TRACK_L + TRACK_W} y={y - 8} textAnchor="end" fontSize={7} className={KICKER_SVG_CLASS}>
          {`+${hidden} more`}
        </text>
      )}
    </g>
  );
}

/** One metric's two populations. `basis` is printed for BOTH sides, always — the n is part of the
 *  reading, not a detail for the curious. */
export function SegmentDistributionRow({ row }: { row: DistributionRow }) {
  const H = SIDE_H * 2 + 8;
  const ariaLabel =
    `${row.label}, 0 to 100. ` +
    [row.a, row.b]
      .map((s) => (s.mean == null ? `${s.name}: ${s.basis}` : `${s.name}: ${s.basis}, ${Math.round(s.mean)}, drawn over ${s.n} item marks`))
      .join("; ") +
    ". Each thin mark is one repository; the ringed mark is the mean. A side with nothing measured is drawn as a gap, never as a zero.";
  return (
    <div data-row={row.id}>
      <div className="flex items-baseline justify-between gap-2">
        <Kicker tone="muted" as="span">{row.label}</Kicker>
        <span className="type-mono-sm text-slate-500">
          {row.a.basis} · {row.b.basis}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <SideTrack s={row.a} y={SIDE_H / 2 + 4} filled />
        <SideTrack s={row.b} y={SIDE_H + SIDE_H / 2 + 4} filled={false} />
      </svg>
    </div>
  );
}

/** The whole set of metric rows, plus the one sr-only table that states every side's mean AND its
 *  basis — the numbers a sighted reader gets from the marks and the printed n. */
export function SegmentDistribution({ rows, title, className = "" }: { rows: DistributionRow[]; title: string; className?: string }) {
  if (rows.length === 0) {
    return (
      <div role="img" aria-label={`${title}: no comparable metric`} className={`type-body-sm text-slate-500 ${className}`}>
        Neither segment has a scanned repo yet.
      </div>
    );
  }
  return (
    <div className={className}>
      <div className="space-y-3">
        {rows.map((r) => (
          <SegmentDistributionRow key={r.id} row={r} />
        ))}
      </div>
      <table className="sr-only">
        <caption>{`${title} · population and mean per side`}</caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Side</th>
            <th scope="col">Mean</th>
            <th scope="col">Basis</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r) =>
            [r.a, r.b].map((s, i) => (
              <tr key={`${r.id}-${i}`}>
                <th scope="row">{r.label}</th>
                <td>{s.name}</td>
                <td>{s.mean == null ? "—" : Math.round(s.mean)}</td>
                <td>{s.basis}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}
