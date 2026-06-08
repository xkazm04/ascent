"use client";

// Dependency-free SVG charts (keeps the bundle small and the build fast).

import { useEffect, useId, useState, useSyncExternalStore, type PointerEvent } from "react";
import type { DimensionResult, MaturityLevel, Posture } from "@/lib/types";
import { POSTURE_THRESHOLD, levelForScore } from "@/lib/maturity/model";
import { DIMENSION_SHORT, LEVEL_GLYPH, scoreHex } from "@/lib/ui";
import { ChartTooltip } from "@/components/report/chartHover";

export function ScoreRing({
  score,
  level,
  size = 200,
}: {
  score: number;
  level: MaturityLevel;
  size?: number;
}) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // Clamp + NaN-guard: a NaN/out-of-range score would make strokeDashoffset NaN and render the
  // ring as a full circle (reads as a perfect 100). scoreHex already clamps the colour; clamp the
  // geometry too so the arc length can't lie.
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  const offset = c * (1 - safeScore / 100);
  const color = scoreHex(score);
  const cx = size / 2;
  const titleId = useId();
  const descId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
    >
      {/* Screen-reader title/desc — the arc length already encodes the score without color. */}
      <title id={titleId}>Overall maturity score</title>
      <desc id={descId}>{`Score ${score} of 100. Level ${level.id} ${level.name}.`}</desc>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
      <text x={cx} y={cx - 6} textAnchor="middle" className="fill-white" fontSize={size * 0.26} fontWeight={700}>
        {score}
      </text>
      <text x={cx} y={cx + 22} textAnchor="middle" fill={color} fontSize={size * 0.085} fontWeight={600}>
        {LEVEL_GLYPH[level.id]} {level.id} · {level.name}
      </text>
    </svg>
  );
}

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
        <circle cx={dataPts[active][0]} cy={dataPts[active][1]} r={8} fill="none" stroke={scoreHex(dimensions[active].score)} strokeWidth={2} />
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
        <ChartTooltip xFrac={dataPts[active][0] / size} yFrac={dataPts[active][1] / size}>
          <div className="text-sm">
            <div className="font-semibold text-white">{dimensions[active].name}</div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="font-mono text-base font-bold tabular-nums" style={{ color: scoreHex(dimensions[active].score) }}>
                {dimensions[active].score}
              </span>
              <span className="text-sm text-slate-400">
                {levelForScore(dimensions[active].score).id} {levelForScore(dimensions[active].score).name}
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

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * True when the user has asked the OS to reduce motion — gate entrance transitions on this.
 * Reads the media query via useSyncExternalStore so there's no setState-in-effect and no SSR
 * hydration mismatch (the server snapshot is always `false`).
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/** Fires `true` one frame after mount, so transitions animate from their initial state. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return mounted;
}

const QUAD_TINT: Record<Posture["id"], string> = {
  "ai-native": "#22c55e",
  ungoverned: "#f97316",
  manual: "#3b9eff",
  early: "#ef4444",
};
const QUAD_LABEL: Record<Posture["id"], string> = {
  "ai-native": "AI-Native",
  ungoverned: "Ungoverned",
  manual: "Manual",
  early: "Getting started",
};

/**
 * The Adoption × Rigor quadrant — the 2D position the model actually computes (postureFor:
 * ai-native / ungoverned / manual / early), plotted instead of left to be inferred from two
 * flat bars. x = adoption, y = rigor, crosshair at POSTURE_THRESHOLD, the repo a glowing dot,
 * and a short trail to the previous scan when history exists. Dependency-free SVG; entrance
 * matches ScoreRing's 0.8s ease and is disabled under prefers-reduced-motion.
 */
export function PostureQuadrant({
  adoption,
  rigor,
  posture,
  prev,
  size = 320,
}: {
  adoption: number;
  rigor: number;
  posture: Posture;
  prev?: { adoption: number; rigor: number } | null;
  size?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const animate = mounted || reduced; // reduced-motion → start at final position, no transition
  const transition = reduced ? undefined : "transform 0.8s ease, opacity 0.8s ease";

  const padL = 34;
  const padB = 30;
  const padT = 16;
  const padR = 16;
  const x0 = padL;
  const y0 = padT;
  const w = size - padL - padR;
  const h = size - padT - padB;
  const toX = (v: number) => x0 + (Math.max(0, Math.min(100, v)) / 100) * w;
  const toY = (v: number) => y0 + (1 - Math.max(0, Math.min(100, v)) / 100) * h;
  const thX = toX(POSTURE_THRESHOLD);
  const thY = toY(POSTURE_THRESHOLD);
  // posture.id comes from the (untrusted) report; an unexpected/drifted id would yield undefined
  // and the "you are here" marker would render with no stroke/fill and vanish. Fall back to the
  // same neutral slate the inactive labels use.
  const color = QUAD_TINT[posture.id] ?? "#475569";

  const dotX = toX(adoption);
  const dotY = toY(rigor);
  const hasTrail = !!prev && (prev.adoption !== adoption || prev.rigor !== rigor);
  const prevX = prev ? toX(prev.adoption) : dotX;
  const prevY = prev ? toY(prev.rigor) : dotY;

  // Region rects keyed by posture id, faint by default and brighter for the active quadrant.
  const regions: { id: Posture["id"]; x: number; y: number; rw: number; rh: number; lx: number; ly: number; anchor: "start" | "end" }[] = [
    { id: "manual", x: x0, y: y0, rw: thX - x0, rh: thY - y0, lx: x0 + 6, ly: y0 + 14, anchor: "start" },
    { id: "ai-native", x: thX, y: y0, rw: x0 + w - thX, rh: thY - y0, lx: x0 + w - 6, ly: y0 + 14, anchor: "end" },
    { id: "early", x: x0, y: thY, rw: thX - x0, rh: y0 + h - thY, lx: x0 + 6, ly: y0 + h - 8, anchor: "start" },
    { id: "ungoverned", x: thX, y: thY, rw: x0 + w - thX, rh: y0 + h - thY, lx: x0 + w - 6, ly: y0 + h - 8, anchor: "end" },
  ];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Posture: ${posture.label}. AI adoption ${adoption} of 100, engineering rigor ${rigor} of 100.`}
      className="max-w-[360px]"
    >
      {/* quadrant tints */}
      {regions.map((r) => {
        const active = r.id === posture.id;
        return (
          <rect
            key={r.id}
            x={r.x}
            y={r.y}
            width={r.rw}
            height={r.rh}
            fill={QUAD_TINT[r.id]}
            opacity={active ? 0.14 : 0.05}
          />
        );
      })}

      {/* plot border */}
      <rect x={x0} y={y0} width={w} height={h} fill="none" stroke="#1e293b" strokeWidth={1} />

      {/* crosshair at the posture threshold */}
      <line x1={thX} y1={y0} x2={thX} y2={y0 + h} stroke="#334155" strokeWidth={1} strokeDasharray="3 3" />
      <line x1={x0} y1={thY} x2={x0 + w} y2={thY} stroke="#334155" strokeWidth={1} strokeDasharray="3 3" />

      {/* quadrant labels */}
      {regions.map((r) => (
        <text
          key={`${r.id}-l`}
          x={r.lx}
          y={r.ly}
          textAnchor={r.anchor}
          fontSize={10}
          fontWeight={r.id === posture.id ? 700 : 500}
          fill={r.id === posture.id ? QUAD_TINT[r.id] : "#475569"}
          className="font-mono uppercase tracking-wider"
        >
          {QUAD_LABEL[r.id]}
        </text>
      ))}

      {/* axis labels */}
      <text x={x0 + w / 2} y={size - 8} textAnchor="middle" fontSize={10} className="fill-slate-500 font-mono uppercase tracking-wider">
        AI Adoption →
      </text>
      <text
        x={12}
        y={y0 + h / 2}
        textAnchor="middle"
        fontSize={10}
        className="fill-slate-500 font-mono uppercase tracking-wider"
        transform={`rotate(-90 12 ${y0 + h / 2})`}
      >
        Rigor →
      </text>

      {/* trail to the previous scan */}
      {hasTrail && (
        <g style={{ opacity: animate ? 1 : 0, transition }}>
          <line x1={prevX} y1={prevY} x2={dotX} y2={dotY} stroke={color} strokeWidth={1.5} strokeDasharray="2 3" opacity={0.5} />
          <circle cx={prevX} cy={prevY} r={3} fill="#0b1322" stroke={color} strokeWidth={1.5} opacity={0.7} />
        </g>
      )}

      {/* the repo, as a glowing dot — animates out from the crosshair on mount */}
      <g
        style={{
          transform: animate ? `translate(${dotX}px, ${dotY}px)` : `translate(${thX}px, ${thY}px)`,
          opacity: animate ? 1 : 0,
          transition,
        }}
      >
        <circle r={13} fill={color} opacity={0.18} />
        <circle r={6} fill={color} stroke="#0b1322" strokeWidth={1.5} />
      </g>
    </svg>
  );
}
