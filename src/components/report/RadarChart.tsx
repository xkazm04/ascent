"use client";

// Dependency-free SVG charts (keeps the bundle small and the build fast).

import { useId, useState, type PointerEvent } from "react";
import type { DimensionResult } from "@/lib/types";
import { levelForScore } from "@/lib/maturity/model";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import { ChartTooltip } from "@/components/report/chartHover";

export function RadarChart({ dimensions, size = 340 }: { dimensions: DimensionResult[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 56;
  const n = dimensions.length;
  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const titleId = useId();
  const descId = useId();

  const point = (i: number, frac: number) => {
    const a = angleFor(i);
    return [cx + radius * frac * Math.cos(a), cy + radius * frac * Math.sin(a)] as const;
  };

  const rings = [0.25, 0.5, 0.75, 1];
  const dataPts = dimensions.map((d, i) => point(i, Math.max(0.04, d.score / 100)));
  const dataPath = dataPts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  // Hover: snap to the nearest data vertex (within a small radius) and show its exact
  // score + level — dependency-free, mirroring the time-series charts' tooltip.
  const [active, setActive] = useState<number | null>(null);
  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const vx = ((e.clientX - rect.left) / rect.width) * size;
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
        viewBox={`0 0 ${size} ${size}`}
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
      {active !== null && (
        // safe: active is a valid index into dataPts/dimensions (set from dataPts.forEach, same length)
        <circle cx={dataPts[active]![0]} cy={dataPts[active]![1]} r={8} fill="none" stroke={scoreHex(dimensions[active]!.score)} strokeWidth={2} />
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
      <rect x={0} y={0} width={size} height={size} fill="transparent" />
      </svg>
      {active !== null && (
        // safe: active is a valid index into dataPts/dimensions (set from dataPts.forEach, same length)
        <ChartTooltip xFrac={dataPts[active]![0] / size} yFrac={dataPts[active]![1] / size}>
          <div className="text-sm">
            <div className="font-semibold text-white">{dimensions[active]!.name}</div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="font-mono text-base font-bold tabular-nums" style={{ color: scoreHex(dimensions[active]!.score) }}>
                {dimensions[active]!.score}
              </span>
              <span className="text-sm text-slate-400">
                {levelForScore(dimensions[active]!.score).id} {levelForScore(dimensions[active]!.score).name}
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
