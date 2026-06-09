"use client";

// Dependency-free SVG charts (keeps the bundle small and the build fast).

import type { Posture } from "@/lib/types";
import { POSTURE_THRESHOLD } from "@/lib/maturity/model";
import { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";

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
