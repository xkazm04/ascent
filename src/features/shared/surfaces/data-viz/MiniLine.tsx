"use client";

// The scene's one line-chart primitive — dependency-free SVG, the domain a REQUIRED prop. Chrome
// (gridlines, tick labels) is drawn only when the series holds data; a gap is a shaded unmeasured
// band with the line broken across it; the trailing partial bucket is a dashed segment ending in a
// hollow point, so today-so-far never masquerades as today. framer-motion draws the runs on once per
// `drawKey`; under `reduced` (a prop, never a media query) the paths render at their end state.

import { motion } from "framer-motion";
import type { Bucket } from "./fixtures";
import { gaps, pathOf, project, runs, ticksFor, type Domain } from "./chartMath";

export type Marker = "dot" | "square" | "diamond";

export function MiniLine({
  series,
  domain,
  color,
  reduced,
  w = 220,
  h = 64,
  pad = 6,
  chrome = false,
  marker = "dot",
  endLabel,
  drawKey = 0,
  ariaLabel,
}: {
  series: readonly Bucket[];
  domain: Domain;
  color: string;
  reduced: boolean;
  w?: number;
  h?: number;
  pad?: number;
  /** Gridlines + tick labels. Only ever true around data (the caller decides; the empty states do not). */
  chrome?: boolean;
  /** The redundant identity channel beside hue: the shape of the end mark. */
  marker?: Marker;
  /** Direct label at the line's end — the legend the eye need not round-trip. */
  endLabel?: string;
  /** Bump to replay the draw-on. */
  drawKey?: number;
  ariaLabel: string;
}) {
  const pts = project(series, domain, { w, h, pad });
  const segs = runs(pts);
  const last = [...pts].reverse().find((p): p is NonNullable<typeof p> => p !== null) ?? null;
  const step = (w - pad * 2) / Math.max(series.length - 1, 1);
  const hasData = segs.length > 0;
  const ticks = ticksFor(domain);
  const yOf = (v: number) => h - pad - ((v - domain[0]) / Math.max(domain[1] - domain[0], 1e-9)) * (h - pad * 2);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="block h-auto w-full overflow-visible" role="img" aria-label={ariaLabel}>
      {chrome && hasData
        ? ticks.map((t) => (
            <g key={t}>
              <line x1={pad} x2={w - pad} y1={yOf(t)} y2={yOf(t)} stroke="var(--color-divider)" strokeWidth={1} />
              <text x={pad - 2} y={yOf(t) + 3} textAnchor="end" fontSize={8} className="fill-slate-600 font-mono">
                {Number.isInteger(t) ? t : t.toFixed(1)}
              </text>
            </g>
          ))
        : null}
      {gaps(series).map(([a, b]) => (
        <rect
          key={`gap-${a}`}
          data-gap
          x={pad + a * step - step / 2}
          y={pad}
          width={(b - a + 1) * step}
          height={h - pad * 2}
          fill="var(--color-divider)"
          opacity={0.35}
        />
      ))}
      {segs.map((run, i) => {
        // The trailing partial point closes its run with a dashed joint, never a solid one.
        const solid = run.filter((p) => !p.partial);
        const partialJoin = run.length >= 2 && run[run.length - 1]!.partial ? run.slice(-2) : null;
        return (
          <g key={i}>
            {solid.length >= 2 ? (
              <motion.path
                key={drawKey}
                d={pathOf(solid)}
                fill="none"
                stroke={color}
                strokeWidth={1.75}
                strokeLinejoin="round"
                initial={reduced ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={reduced ? { duration: 0 } : { duration: 0.6, ease: "easeOut" }}
              />
            ) : null}
            {partialJoin ? <path data-partial-join d={pathOf(partialJoin)} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="3 3" /> : null}
            {run.length < 2 || solid.length < 2
              ? run.map((p) => <circle key={p.day} cx={p.x} cy={p.y} r={2.2} fill={p.partial ? "var(--color-ink)" : color} stroke={color} strokeWidth={1.5} />)
              : null}
          </g>
        );
      })}
      {last ? <EndMark p={last} color={color} marker={marker} /> : null}
      {last && endLabel ? (
        // Direct label at the line's end; past the right edge it sits above the mark, anchored end.
        <text x={last.x + 6 > w - 40 ? last.x : last.x + 6} y={last.x + 6 > w - 40 ? last.y - 6 : last.y + 3} fontSize={9} textAnchor={last.x + 6 > w - 40 ? "end" : "start"} fill={color} className="font-mono">
          {endLabel}
        </text>
      ) : null}
    </svg>
  );
}

/** End marker: hollow when the point is today-so-far; shape per series as the non-hue channel. */
function EndMark({ p, color, marker }: { p: { x: number; y: number; partial: boolean }; color: string; marker: Marker }) {
  const fill = p.partial ? "var(--color-ink)" : color;
  const common = { fill, stroke: color, strokeWidth: 1.5, "data-partial": p.partial || undefined } as const;
  if (marker === "square") return <rect x={p.x - 3} y={p.y - 3} width={6} height={6} {...common} />;
  if (marker === "diamond") return <rect x={p.x - 3} y={p.y - 3} width={6} height={6} transform={`rotate(45 ${p.x} ${p.y})`} {...common} />;
  return <circle cx={p.x} cy={p.y} r={3} {...common} />;
}
