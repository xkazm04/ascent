"use client";

// Dependency-free SVG charts (keeps the bundle small and the build fast).

import { useId, useState, type PointerEvent } from "react";
import type { DimensionResult } from "@/lib/types";
import { levelForScore } from "@/lib/maturity/model";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import { ChartTooltip } from "@/components/report/chartHover";

export function RadarChart({ dimensions, size = 340 }: { dimensions: DimensionResult[]; size?: number }) {
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

  // Round to 2dp: Node and the browser can disagree on the last ULP of Math.cos/sin, which surfaces
  // as a hydration mismatch on the raw SVG coordinate strings (axes/labels/dots). 2dp is sub-pixel here.
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const point = (i: number, frac: number) => {
    const a = angleFor(i);
    return [r2(cx + radius * frac * Math.cos(a)), r2(cy + radius * frac * Math.sin(a))] as const;
  };

  const rings = [0.25, 0.5, 0.75, 1];
  const dataPts = dimensions.map((d, i) => point(i, Math.max(0.04, d.score / 100)));
  // Validate `active` against the CURRENT arrays before use: it persists across renders but is only
  // checked at set-time, so if a parent swaps `dimensions` for a shorter (non-empty) array while a
  // vertex tooltip is open, `dataPts[active]` is undefined and `undefined![0]` would throw mid-render.
  // Resolve to a concrete point/dim once and gate the ring + tooltip on them (the DimLine pattern),
  // dropping the non-null assertions.
  const actPt = active != null ? dataPts[active] : undefined;
  const actDim = active != null ? dimensions[active] : undefined;
  const dataPath = dataPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const vx = -labelPadX + ((e.clientX - rect.left) / rect.width) * vbWidth;
    const vy = ((e.clientY - rect.top) / rect.height) * size;
    let best = -1;
    let bestDist = Infinity;
    dataPts.forEach(([x, y], i) => {
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
        style={{ touchAction: "none" }}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
      >
        <title id={titleId}>Maturity radar</title>
        <desc id={descId}>
          {`Scores across ${n} maturity dimensions on a 0 to 100 scale. Per-dimension values are listed in the adjacent table.`}
        </desc>
        {/* grid rings */}
      {rings.map((rg) => (
        <polygon
          key={rg}
          points={dimensions.map((_, i) => point(i, rg).map((v) => v.toFixed(1)).join(",")).join(" ")}
          fill="none"
          stroke="#1e293b"
          strokeWidth={1}
        />
      ))}
      {/* axes */}
      {dimensions.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#1e293b" strokeWidth={1} />;
      })}
      {/* data polygon */}
      <polygon points={dataPath} fill="rgba(59,158,255,0.22)" stroke="#3b9eff" strokeWidth={2} />
      {dataPts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === active ? 4.5 : 3} fill="#7bbcff" />
      ))}
      {/* hovered vertex highlight */}
      {actPt && actDim && (
        <circle cx={actPt[0]} cy={actPt[1]} r={8} fill="none" stroke={scoreHex(actDim.score)} strokeWidth={2} />
      )}
      {/* labels */}
      {dimensions.map((d, i) => {
        const [x, y] = point(i, 1.2);
        const anchor = Math.abs(x - cx) < 8 ? "middle" : x > cx ? "start" : "end";
        return (
          <text key={d.id} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" fontSize={11} className="fill-slate-400">
            {DIMENSION_SHORT[d.id]}
            <tspan dx={4} className="fill-slate-500" fontWeight={600}>
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
      {/* Visually-hidden equivalent of the radar — lets screen readers read every dimension's
          score (and band) instead of a single opaque "radar" image. */}
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
                <th scope="row">{d.name}</th>
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
