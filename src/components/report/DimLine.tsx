"use client";

import { useRouter } from "next/navigation";
import { BAND_EDGES, CHART_INK, levelBandRects, vScale, xScale } from "@/components/report/chartScale";
import { ChartTooltip, PointTooltip, useChartHover } from "@/components/report/chartHover";
import { scoreHex } from "@/lib/ui";

/** Per-scan metadata aligned 1:1 with a DimLine's values array (for hover tooltips + deep links). */
export interface ScanMeta {
  at: string;
  engine: string;
  /** Short commit sha this scan pinned to, shown in the tooltip as context. */
  sha?: string;
  /** Pinned-report permalink (reportPermalink) — click on the hovered point opens it, so a
   *  per-dimension movement leads straight to the scan where it happened (mirrors TrendChart). */
  href?: string;
  /** External GitHub commit URL (githubCommitUrl) — shift-click opens it in a new tab. */
  commitUrl?: string;
}

/**
 * Responsive 0..100 line chart that fills its container width. A `null` value marks a
 * scan where this dimension was ABSENT (e.g. a dimension added after that scan) — it is
 * rendered as a gap in the line, never as a 0. Coercing absent→0 would fabricate a
 * crash-to-zero-and-recover that never happened. Hover snaps to the nearest present point.
 */
export function DimLine({
  values,
  meta,
  name,
  current,
}: {
  values: (number | null)[];
  meta: ScanMeta[];
  name?: string;
  current?: number;
}) {
  const W = 320;
  const H = 90;
  const x = xScale(values.length, 0, W);
  const y = vScale(H, 8, 8);

  // Only the present points are hoverable — gaps have no value to show.
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null);
  const hover = useChartHover(present.map((p) => x(p.i)), W);
  const a = hover.active;

  // Build the path in segments, breaking it wherever a value is missing so the line never
  // dives through 0 to bridge a gap.
  let path = "";
  let penDown = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      // null marks a gap; undefined is unreachable (i is in-bounds) but narrows v to number
      penDown = false;
      continue;
    }
    path += `${penDown ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    penDown = true;
  }

  const lastReal = [...values].reverse().find((v): v is number => v !== null) ?? 0;
  const drawnCount = present.length;
  const act = a !== null ? present[a] : null;
  // Delta vs the prior PRESENT point (gaps are skipped, so this compares real scans).
  // safe: a is a valid index into present (from useChartHover over present), and a > 0
  const actDelta = a !== null && a > 0 ? present[a]!.v - present[a - 1]!.v : null;

  // Deep links for the hovered point (mirrors TrendChart): click → the pinned report where this
  // dimension moved; shift-click → the exact GitHub commit. Points without metadata stay inert.
  const router = useRouter();
  const actMeta = act ? meta[act.i] : undefined;

  return (
    <div className="relative mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={
          name
            ? `${name} score trend${current !== undefined ? `, currently ${current} of 100` : ""}`
            : "Dimension trend"
        }
        style={{ touchAction: "none", cursor: actMeta?.href || actMeta?.commitUrl ? "pointer" : undefined }}
        onPointerMove={hover.onPointerMove}
        onPointerLeave={hover.onPointerLeave}
        onClick={(e) => {
          if (e.shiftKey && actMeta?.commitUrl) window.open(actMeta.commitUrl, "_blank", "noopener");
          else if (actMeta?.href) router.push(actMeta.href);
        }}
      >
        {/* Shaded maturity bands — same strata as the overall chart, so both read on one frame. */}
        {levelBandRects(y).map((band) => (
          <rect key={band.min} x={0} y={band.top} width={W} height={band.height} fill={band.color} />
        ))}
        {BAND_EDGES.filter((e) => e > 0 && e < 100).map((b) => (
          <line key={b} x1={0} x2={W} y1={y(b)} y2={y(b)} stroke={CHART_INK.grid} strokeWidth={1} strokeDasharray="2 4" />
        ))}
        {/* One mid-scale reference so the sparkline reads as a quantitative chart, not a floating
            squiggle — the L4 "Integrated" threshold (65) anchors the otherwise-unlabeled bands. */}
        <text x={3} y={y(65) - 2} fontSize={8} className="fill-slate-600">
          65
        </text>
        {act && <line x1={x(act.i)} x2={x(act.i)} y1={0} y2={H} stroke={CHART_INK.crosshair} strokeWidth={1} strokeDasharray="3 3" />}
        {drawnCount > 1 && <path d={path.trim()} fill="none" stroke={scoreHex(lastReal)} strokeWidth={2.25} />}
        {values.map((v, i) =>
          v === null ? null : (
            <circle key={i} cx={x(i)} cy={y(v)} r={i === values.length - 1 ? 4 : 2.5} fill={scoreHex(v)} />
          ),
        )}
        {act && (
          <circle cx={x(act.i)} cy={y(act.v)} r={5.5} fill="none" stroke={scoreHex(act.v)} strokeWidth={1.75} />
        )}
        <rect x={0} y={0} width={W} height={H} fill="transparent" />
      </svg>
      {act && (
        <ChartTooltip xFrac={x(act.i) / W} yFrac={y(act.v) / H}>
          <PointTooltip
            score={act.v}
            at={actMeta?.at}
            engine={actMeta?.engine}
            delta={actDelta}
            sha={actMeta?.sha}
            linked={Boolean(actMeta?.href)}
            commitLinked={Boolean(actMeta?.commitUrl)}
          />
        </ChartTooltip>
      )}
    </div>
  );
}
