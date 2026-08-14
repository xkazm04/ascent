"use client";

import { useRouter } from "next/navigation";
import { BAND_EDGES, CHART_INK, levelBandRects, vScale, xScale } from "@/components/report/chartScale";
import { ChartTooltip, PointTooltip, useChartHover, useCoarseTapToOpen } from "@/components/report/chartHover";
import { MOCK_SR_SUFFIX, isMockEngine } from "@/components/report/chartEngine";
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

/** A hoverable point: its value plus the original index into the (gapped) `values` array. */
type PresentPoint = { v: number; i: number };

/** The present (non-null) points, carrying their original index so `meta`/x() stay aligned. */
export function presentPoints(values: (number | null)[]): PresentPoint[] {
  return values.map((v, i) => ({ v, i })).filter((p): p is PresentPoint => p.v !== null);
}

/**
 * Delta of the hovered point vs the prior PRESENT point (gaps skipped, so this compares real
 * scans). Returns null for the first point (active === 0), no hover (null), or a STALE/out-of-bounds
 * index — it never dereferences an absent element. The crash this replaces: the range toggle
 * shrinks `present` while a point is hovered, leaving `active` past the new end; the old
 * `present[active]!.v` non-null assertion then threw mid-render and white-screened the Trends
 * section. (useChartHover now also resets `active` on resize — this is the read-site belt to that
 * hook's braces.)
 */
export function deltaAt(present: PresentPoint[], active: number | null): number | null {
  if (active == null || active <= 0) return null;
  const cur = present[active];
  const prev = present[active - 1];
  return cur && prev ? cur.v - prev.v : null;
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
  const present = presentPoints(values);
  const hover = useChartHover(present.map((p) => x(p.i)), W);
  const a = hover.active;
  const tap = useCoarseTapToOpen();

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
  // `a` is kept in-bounds by useChartHover (reset on resize); still, index defensively — a stale
  // index yields `undefined` (rendered as nothing) rather than a thrown assertion.
  const act = a !== null ? present[a] : undefined;
  // Delta vs the prior PRESENT point — pure, out-of-bounds-safe (see deltaAt above).
  const actDelta = deltaAt(present, a);

  // Deep links for the hovered point (mirrors TrendChart): click → the pinned report where this
  // dimension moved; shift-click → the exact GitHub commit. Points without metadata stay inert.
  const router = useRouter();
  const actMeta = act ? meta[act.i] : undefined;

  // Short date for the screen-reader link list below (the svg has no visible date axis).
  const srDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  // Screen-reader equivalent of the whole trajectory: EVERY present point's score (+ short date),
  // not just the ones that deep-link. Previously this list was filtered to href-bearing points, so a
  // repo with no pinned-report links rendered zero SR items and the historical series was invisible to
  // assistive tech (only the svg's "currently N of 100" survived). Points that DO carry a permalink are
  // still wrapped in a real <a>, so keyboard / SR users keep the same per-point report the pointer-only
  // svg (role="img" + onClick) opens; unlinked points contribute their value as plain text.
  const srPoints = present;

  // All values null → this dimension has no trajectory at all. The line was already suppressed
  // (`drawnCount > 1`), but the level bands, gridlines and "65" axis label still rendered, so an
  // empty series looked like a real chart whose line happened to sit off-frame. Mirror RadarChart's
  // labeled placeholder instead. Placed AFTER every hook (useChartHover / useCoarseTapToOpen /
  // useRouter above) to satisfy the Rules of Hooks, and sized to the svg's own 320×90 aspect so
  // swapping between states costs no layout shift.
  if (drawnCount === 0) {
    return (
      <div
        className="mt-2 flex aspect-[320/90] w-full items-center justify-center rounded-lg border border-dashed border-divider text-sm text-slate-500"
        role="img"
        aria-label={name ? `${name}: no trend data` : "No trend data"}
      >
        No trend data
      </div>
    );
  }

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
        onPointerMove={(e) => {
          tap.notePointer(e);
          hover.onPointerMove(e);
        }}
        // Also snap on pointer-down so a stationary touch tap (which may not fire pointermove) still
        // reveals the nearest point before the click is evaluated.
        onPointerDown={(e) => {
          tap.notePointer(e);
          hover.onPointerMove(e);
        }}
        onPointerLeave={hover.onPointerLeave}
        onClick={(e) => {
          if (e.shiftKey && actMeta?.commitUrl) window.open(actMeta.commitUrl, "_blank", "noopener");
          // On touch the first tap only reveals the point's tooltip; a second tap on it navigates.
          else if (actMeta?.href && tap.shouldOpen(a)) router.push(actMeta.href);
        }}
      >
        {/* Shaded maturity bands — same strata as the overall chart, so both read on one frame. */}
        {levelBandRects(y).map((band) => (
          <rect key={band.min} x={0} y={band.top} width={W} height={band.height} fill={band.color} />
        ))}
        {BAND_EDGES.filter((e) => e > 0 && e < 100).map((b) => (
          <line key={b} x1={0} x2={W} y1={y(b)} y2={y(b)} stroke="var(--color-divider)" strokeWidth={1} strokeDasharray="2 4" />
        ))}
        {/* One mid-scale reference so the sparkline reads as a quantitative chart, not a floating
            squiggle — the L4 "Integrated" threshold (65) anchors the otherwise-unlabeled bands. */}
        <text x={3} y={y(65) - 2} fontSize={8} className="fill-slate-600">
          65
        </text>
        {act && <line x1={x(act.i)} x2={x(act.i)} y1={0} y2={H} stroke={CHART_INK.crosshair} strokeWidth={1} strokeDasharray="3 3" />}
        {drawnCount > 1 && <path d={path.trim()} fill="none" stroke={scoreHex(lastReal)} strokeWidth={2.25} />}
        {values.map((v, i) => {
          if (v === null) return null;
          const r = i === values.length - 1 ? 4 : 2.5;
          // A mock-engine scan is a deterministic rubric run with no model contribution — it is not
          // comparable to an LLM-scored point, and a solid dot on the same line asserted that it was
          // (see MOCK_ENGINE / DimensionTrends' footnote). Draw it HOLLOW: same score hue on the
          // stroke so the value ramp is untouched, surface-colored fill so the mark reads as "not
          // filled in". Shape carries the caveat, not colour.
          return isMockEngine(meta[i]?.engine) ? (
            <circle key={i} data-mock cx={x(i)} cy={y(v)} r={r + 0.5} fill="var(--color-surface-strong)" stroke={scoreHex(v)} strokeWidth={1.75} />
          ) : (
            <circle key={i} cx={x(i)} cy={y(v)} r={r} fill={scoreHex(v)} />
          );
        })}
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
      {srPoints.length > 0 && (
        <ul className="sr-only">
          {srPoints.map((p) => {
            const mp = meta[p.i];
            const when = mp?.at ? srDate(mp.at) : "";
            // The hollow-dot caveat is visual only; repeat it in words so a screen-reader user isn't
            // told a demo score and a model score in the same neutral voice.
            const label =
              `${name ? name + " " : ""}${p.v} of 100${when ? ` on ${when}` : ""}` +
              (isMockEngine(mp?.engine) ? MOCK_SR_SUFFIX : "");
            return (
              <li key={p.i}>
                {mp?.href ? <a href={mp.href}>{`${label}. Open this scan's report`}</a> : label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
