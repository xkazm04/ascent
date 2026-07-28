"use client";

// Dependency-free SVG charts (keeps the bundle small and the build fast).

import { useId, useState, type PointerEvent } from "react";
import type { DimensionId, DimensionResult } from "@/lib/types";
import { levelForScore } from "@/lib/maturity/model";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import { ChartTooltip } from "@/components/report/chartHover";
import { RadarFallback } from "@/components/report/RadarFallback";
import { r2 } from "@/components/report/svgCoord";

/** Fixed radius the zero MARKER is parked at. It is not a vertex — the polygon still closes through
 *  the true centre — only the place the "this dimension scored zero" ring is drawn so it is legible
 *  and hoverable instead of stacking on the centre pixel with every other zero. */
const ZERO_MARK_FRAC = 0.04;

export function RadarChart({
  dimensions,
  size = 340,
  highlightId = null,
  onSelect,
}: {
  dimensions: DimensionResult[];
  size?: number;
  /** Persistently ring + emphasise this dimension's vertex (kept in sync with an external selection,
   *  e.g. the Dimensions explorer's bar list). No-op visual when null / not found. */
  highlightId?: DimensionId | null;
  /** When provided, the radar becomes a picker: clicking near a vertex selects that dimension. */
  onSelect?: (id: DimensionId) => void;
}) {
  const titleId = useId();
  const descId = useId();
  // Hover: snap to the nearest data vertex (within a small radius) and show its exact
  // score + level — dependency-free, mirroring the time-series charts' tooltip.
  const [active, setActive] = useState<number | null>(null);

  // Self-guard against an empty dimension set: angleFor (below) divides by `n`, so n === 0 makes every
  // vertex NaN and silently collapses the polygon/labels to nothing — reading as a CSS glitch, not a
  // data problem. The streamed report path rejects empty dimensions upstream, but a direct caller
  // (e.g. RoadmapSandbox) can pass [], so guard here. Placed AFTER the hooks to satisfy Rules of Hooks.
  if (dimensions.length === 0) {
    return (
      <div
        className="mx-auto flex aspect-square w-full max-w-[340px] items-center justify-center text-sm text-slate-500"
        role="img"
        aria-label="No dimension data to chart"
      >
        No dimension data
      </div>
    );
  }

  // 1 or 2 dimensions: the polygon math is valid but degenerate (a point, or a zero-area line), so
  // the radar would render as an invisible shape over data that exists. Degrade to labeled bars —
  // the honest form for one or two magnitudes — instead of a shape with no area. See RadarFallback.
  if (dimensions.length < 3) {
    return <RadarFallback dimensions={dimensions} highlightId={highlightId} onSelect={onSelect} />;
  }

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 56;
  // Horizontal bleed in the viewBox so the side axis labels (textAnchor start/end at frac 1.2 — e.g.
  // the west "AI Process") can't be clipped at the left/right edges, where the SVG root would crop
  // them. Symmetric around cx so the plot stays centered (and circular under uniform scaling); the
  // pointer + tooltip math below account for the shifted -labelPadX origin.
  const labelPadX = 48;
  const vbWidth = size + labelPadX * 2;
  const n = dimensions.length;
  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

  // Round to 2dp (see svgCoord): Node and the browser can disagree on the last ULP of Math.cos/sin,
  // which surfaces as a hydration mismatch on the raw SVG coordinate strings (axes/labels/dots).
  const point = (i: number, frac: number) => {
    const a = angleFor(i);
    return [r2(cx + radius * frac * Math.cos(a)), r2(cy + radius * frac * Math.sin(a))] as const;
  };

  const rings = [0.25, 0.5, 0.75, 1];
  const highlightIdx = highlightId ? dimensions.findIndex((d) => d.id === highlightId) : -1;
  // The plotted polygon uses each dimension's TRUE fraction. The old `Math.max(0.04, score/100)`
  // floor gave a zero-scoring dimension a visible spoke, inflating the shape for exactly the
  // dimensions the chart most needs to represent honestly — a 0 read as a small positive.
  const polyPts = dimensions.map((d, i) => point(i, d.score / 100));
  // A vertex sitting AT the centre is neither legible nor grabbable, and every zero would stack on
  // the same pixel — so a zero gets its own MARKER instead: parked at a fixed small radius on its
  // own axis and drawn as a hollow dashed ring rather than a solid dot. The ring reads as "empty",
  // contributes no area to the polygon (which still closes through the centre), and stays hoverable.
  const markPts = dimensions.map((d, i) => (d.score === 0 ? point(i, ZERO_MARK_FRAC) : polyPts[i]!));
  const anyZero = dimensions.some((d) => d.score === 0);
  // Validate `active` against the CURRENT arrays before use: it persists across renders but is only
  // checked at set-time, so if a parent swaps `dimensions` for a shorter (non-empty) array while a
  // vertex tooltip is open, `dataPts[active]` is undefined and `undefined![0]` would throw mid-render.
  // Resolve to a concrete point/dim once and gate the ring + tooltip on them (the DimLine pattern),
  // dropping the non-null assertions.
  const actPt = active != null ? markPts[active] : undefined;
  const actDim = active != null ? dimensions[active] : undefined;
  const dataPath = polyPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const vx = -labelPadX + ((e.clientX - rect.left) / rect.width) * vbWidth;
    const vy = ((e.clientY - rect.top) / rect.height) * size;
    let best = -1;
    let bestDist = Infinity;
    markPts.forEach(([x, y], i) => {
      const dist = Math.hypot(x - vx, y - vy);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setActive(bestDist <= size * 0.1 ? best : null);
  }

  return (
    <div className="relative mx-auto w-full max-w-[340px]">
      <svg
        viewBox={`${-labelPadX} 0 ${vbWidth} ${size}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        style={{ touchAction: "none", cursor: onSelect ? "pointer" : undefined }}
        onPointerMove={onPointerMove}
        // Also snap on pointer-down so a stationary touch tap (which may not fire pointermove) still
        // resolves `active` before the click is evaluated — the DimLine/TrendChart pattern. Without
        // it a touch tap was a silent no-op.
        onPointerDown={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onClick={() => {
          // The hover/tap snap already resolved the nearest vertex into `active`; reuse it as the
          // click target so a tap on the plot selects the closest dimension.
          if (onSelect && active !== null) onSelect(dimensions[active]!.id);
        }}
      >
        <title id={titleId}>Maturity radar</title>
        <desc id={descId}>
          {`Scores across ${n} maturity dimensions on a 0 to 100 scale. Per-dimension values are listed in the adjacent table.` +
            (anyZero
              ? " Dimensions scoring zero plot at the centre and are marked with a hollow dashed ring rather than a plotted vertex."
              : "")}
        </desc>
        {/* grid rings */}
      {rings.map((rg) => (
        <polygon
          key={rg}
          points={dimensions.map((_, i) => point(i, rg).map((v) => v.toFixed(1)).join(",")).join(" ")}
          fill="none"
          stroke="var(--color-divider)"
          strokeWidth={1}
        />
      ))}
      {/* axes */}
      {dimensions.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--color-divider)" strokeWidth={1} />;
      })}
      {/* data polygon — follows the brand tokens (--color-accent + its soft tint) so a re-skin /
          white-label retunes the chart with the buttons instead of leaving it on the old azure. */}
      <polygon points={dataPath} fill="var(--color-accent)" fillOpacity={0.22} stroke="var(--color-accent)" strokeWidth={2} />
      {markPts.map(([x, y], i) => {
        const r = i === active || i === highlightIdx ? 4.5 : 3;
        // Zero → a hollow dashed ring, never a filled dot. A filled dot at any radius asserts a
        // measured magnitude; the open, broken outline reads as an absence, and the axis numeral
        // beside it already says "0".
        return dimensions[i]!.score === 0 ? (
          <circle key={i} data-zero cx={x} cy={y} r={r + 1.5} fill="none" stroke={scoreHex(0)} strokeWidth={1.5} strokeDasharray="2 2" />
        ) : (
          <circle key={i} cx={x} cy={y} r={r} fill="var(--color-accent-soft)" />
        );
      })}
      {/* selected vertex — a persistent ring synced to the external selection (the bar list) */}
      {highlightIdx >= 0 && (
        <circle cx={markPts[highlightIdx]![0]} cy={markPts[highlightIdx]![1]} r={7} fill="none" stroke={scoreHex(dimensions[highlightIdx]!.score)} strokeWidth={2.5} />
      )}
      {/* hovered vertex highlight */}
      {actPt && actDim && (
        <circle cx={actPt[0]} cy={actPt[1]} r={8} fill="none" stroke={scoreHex(actDim.score)} strokeWidth={2} />
      )}
      {/* labels */}
      {dimensions.map((d, i) => {
        const [x, y] = point(i, 1.2);
        const anchor = Math.abs(x - cx) < 8 ? "middle" : x > cx ? "start" : "end";
        const isHi = i === highlightIdx;
        return (
          <text
            key={d.id}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={11}
            fontWeight={isHi ? 700 : undefined}
            className={isHi ? "fill-slate-100" : "fill-slate-400"}
          >
            {DIMENSION_SHORT[d.id]}
            {/* Default numeral lifted slate-500 → slate-400: these nine per-dimension scores are a
                primary readout, and slate-500 (#64748b) on the panel is ~3.9:1 — below WCAG AA 4.5:1
                for 11px text. slate-400 (#94a3b8) clears it; the active/highlight state stays -300. */}
            <tspan dx={4} className={isHi ? "fill-slate-300" : "fill-slate-400"} fontWeight={600}>
              {d.score}
            </tspan>
          </text>
        );
      })}
      {/* transparent capture layer so pointer moves register across the whole plot */}
      <rect x={-labelPadX} y={0} width={vbWidth} height={size} fill="transparent" />
      </svg>
      {actPt && actDim && (
        <ChartTooltip xFrac={(actPt[0] + labelPadX) / vbWidth} yFrac={actPt[1] / size}>
          <div className="text-sm">
            <div className="font-semibold text-white">{actDim.name}</div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="font-mono text-base font-bold tabular-nums" style={{ color: scoreHex(actDim.score) }}>
                {actDim.score}
              </span>
              <span className="text-sm text-slate-400">
                {levelForScore(actDim.score).id} {levelForScore(actDim.score).name}
              </span>
            </div>
          </div>
        </ChartTooltip>
      )}
      {anyZero && (
        // Legend for the zero mark. Shape-only encoding needs a key, and this is the one mark on the
        // chart that means "no magnitude" rather than "a small magnitude".
        <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
          <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3 shrink-0">
            <circle cx={6} cy={6} r={4} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="2 2" />
          </svg>
          <span>Dashed ring = scored 0 (plotted at the centre, not as a spoke).</span>
        </p>
      )}
      {/* Visually-hidden equivalent of the radar — lets screen readers read every dimension's
          score (and band) instead of a single opaque "radar" image. When the radar is a picker,
          each row header is a real <button> mirroring the pointer pick (DimLine's sr-only link-list
          pattern), so keyboard/SR users get the same selection path the SVG offers pointers. */}
      <table className="sr-only">
        <caption>Maturity score by dimension</caption>
        <thead>
          <tr>
            <th scope="col">Dimension</th>
            <th scope="col">Score out of 100</th>
            <th scope="col">Level</th>
          </tr>
        </thead>
        <tbody>
          {dimensions.map((d) => {
            const lvl = levelForScore(d.score);
            return (
              <tr key={d.id}>
                <th scope="row">
                  {onSelect ? (
                    <button type="button" onClick={() => onSelect(d.id)}>
                      {d.name}
                    </button>
                  ) : (
                    d.name
                  )}
                </th>
                <td>{d.score}</td>
                <td>{`${lvl.id} ${lvl.name}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
