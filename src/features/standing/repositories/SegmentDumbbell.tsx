// Two segments, one axis — the paired-row ("dumbbell") chart that replaced two columns of figures.
//
// Each row is one metric on a shared 0–100 track: A is the filled mark, B is the hollow one, and the
// bar between them IS the delta. A reader sees which slice leads, by how much, and on which metrics
// the two agree — the three readings the number columns made them compute. Where a side has no
// scanned repo it has no value at all (`null` from segmentViz.ts): nothing is drawn there, per §2.4,
// so a sentinel zero can neither be plotted nor printed.
//
// Server-safe: no hooks, no handlers, no motion. Colour is scoreHex (the level ramp, which is what
// these numbers are) plus CSS tokens — no hand-picked hex (BRAND.md).

import { Kicker } from "@/components/ui";
import { deltaHex, fmtDelta } from "@/components/org/shared/ui";
import { KICKER_SVG_CLASS, r2 } from "@/components/org/viz";
import { scoreHex } from "@/lib/ui";
import type { PairedRow } from "./segmentViz";

const W = 300;
const ROW_H = 22;
const HEAD_H = 14;
const LABEL_W = 74;
const DELTA_W = 34;
const TRACK_L = LABEL_W;
const TRACK_W = W - LABEL_W - DELTA_W;

const x = (v: number) => r2(TRACK_L + (Math.max(0, Math.min(100, v)) / 100) * TRACK_W);

export function SegmentDumbbell({
  rows,
  aName,
  bName,
  title,
  className = "",
}: {
  rows: PairedRow[];
  aName: string;
  bName: string;
  /** Noun phrase naming the set of metrics, e.g. "Headline metrics". */
  title: string;
  className?: string;
}) {
  if (rows.length === 0) {
    return (
      <div role="img" aria-label={`${title}: no comparable metric`} className={`type-body-sm text-slate-500 ${className}`}>
        Neither segment has a scanned repo yet.
      </div>
    );
  }

  const H = HEAD_H + rows.length * ROW_H;
  const say = (v: number | null) => (v == null ? "no scanned repo" : String(Math.round(v)));
  const ariaLabel =
    `${title}: ${aName} versus ${bName}, 0 to 100. ` +
    rows.map((r) => `${r.label} — ${aName} ${say(r.a)}, ${bName} ${say(r.b)}`).join("; ") +
    ". A side with no scanned repository is drawn as a gap, never as a zero.";

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        <text x={TRACK_L} y={HEAD_H - 5} fontSize={8} className={KICKER_SVG_CLASS}>0</text>
        <text x={TRACK_L + TRACK_W} y={HEAD_H - 5} textAnchor="end" fontSize={8} className={KICKER_SVG_CLASS}>100</text>

        {rows.map((r, i) => {
          const cy = r2(HEAD_H + i * ROW_H + ROW_H / 2);
          return (
            <g key={r.id} data-row={r.id}>
              <text x={0} y={cy + 3} fontSize={9} className={KICKER_SVG_CLASS}>
                {r.label}
              </text>
              <line x1={TRACK_L} y1={cy} x2={TRACK_L + TRACK_W} y2={cy} stroke="var(--color-divider)" strokeWidth={1} strokeOpacity={0.6} />
              {r.a != null && r.b != null && (
                <line data-span x1={x(r.a)} y1={cy} x2={x(r.b)} y2={cy} stroke="var(--color-accent)" strokeWidth={3} strokeOpacity={0.35} strokeLinecap="round" />
              )}
              {r.a != null && (
                <circle data-a cx={x(r.a)} cy={cy} r={4} fill={scoreHex(r.a)}>
                  <title>{`${aName} — ${r.label} ${Math.round(r.a)}`}</title>
                </circle>
              )}
              {r.b != null && (
                <circle data-b cx={x(r.b)} cy={cy} r={4} fill="var(--color-surface-strong)" stroke={scoreHex(r.b)} strokeWidth={1.5}>
                  <title>{`${bName} — ${r.label} ${Math.round(r.b)}`}</title>
                </circle>
              )}
              {r.delta != null ? (
                <text x={W} y={cy + 3} textAnchor="end" fontSize={9} className="font-mono tabular-nums" fill={deltaHex(r.delta)}>
                  {fmtDelta(r.delta)}
                </text>
              ) : (
                <text x={W} y={cy + 3} textAnchor="end" fontSize={9} className="fill-slate-600 font-mono">
                  —
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5">
          <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden className="shrink-0">
            <circle cx={5} cy={5} r={4} fill="var(--color-accent)" />
          </svg>
          <Kicker tone="muted" as="span">{aName}</Kicker>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden className="shrink-0">
            <circle cx={5} cy={5} r={3.4} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} />
          </svg>
          <Kicker tone="muted" as="span">{bName}</Kicker>
        </span>
      </div>

      <table className="sr-only">
        <caption>{`${title} — ${aName} versus ${bName}`}</caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">{aName}</th>
            <th scope="col">{bName}</th>
            <th scope="col">Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row">{r.label}</th>
              <td>{say(r.a)}</td>
              <td>{say(r.b)}</td>
              <td>{r.delta == null ? "—" : fmtDelta(r.delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
