"use client";

// AltimeterGauge — the nine dimensions as nine climbers on ONE elevation gauge. The five maturity
// bands are the strata (L1 Manual at the valley floor, L5 Autonomous at the summit); every dimension
// hangs a rope from the floor up to its score, with a hollow marker where the previous scan left it.
// Reading it is spatial: what is high, what is low, who moved, and how far the next rung is — the
// same facts as a bar list, but on the brand's own vertical (ascent-as-climb, the `.strata` motif).
// Dependency-free SVG; entrances are draw-ons gated on reduced motion.

import type { KeyboardEvent } from "react";
import type { DimensionId } from "@/lib/types";
import { LEVELS } from "@/lib/maturity/model";
import { LEVEL_HEX, scoreGlyph, scoreHex } from "@/lib/ui";
import { deltaHex } from "@/components/ui";
import type { DimFacts } from "@/components/report/dimensionExplorerDerive";

const W = 720;
const H = 330;
const PAD_TOP = 18;
const PAD_BOTTOM = 40;
const GUTTER = 96;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;
const y = (score: number) => PAD_TOP + ((100 - score) / 100) * PLOT_H;

export function AltimeterGauge({
  facts,
  selectedId,
  onSelect,
  mounted,
  reduced,
}: {
  facts: DimFacts[];
  selectedId: DimensionId;
  onSelect: (id: DimensionId) => void;
  mounted: boolean;
  reduced: boolean;
}) {
  const n = Math.max(1, facts.length);
  const colW = (W - GUTTER - 12) / n;
  const cx = (i: number) => GUTTER + colW * (i + 0.5);
  const drawn = mounted || reduced;

  const onKey = (e: KeyboardEvent<SVGGElement>, i: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(facts[i]!.id);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const j = (i + (e.key === "ArrowRight" ? 1 : -1) + n) % n;
      onSelect(facts[j]!.id);
      (e.currentTarget.parentElement?.children[j] as SVGGElement | undefined)?.focus();
    }
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="group"
      aria-label="Elevation gauge: each dimension's score against the five maturity bands"
    >
      {/* Strata — the five level bands, floor rules + band names on the gutter. */}
      {LEVELS.map((l, i) => (
        <g key={l.id}>
          <rect
            x={GUTTER}
            y={y(l.band[1])}
            width={W - GUTTER}
            height={y(l.band[0]) - y(l.band[1])}
            fill={LEVEL_HEX[l.id]}
            opacity={i % 2 === 0 ? 0.045 : 0.025}
          />
          <line x1={GUTTER} x2={W} y1={y(l.band[0])} y2={y(l.band[0])} stroke="var(--color-divider)" strokeWidth={1} />
          <text x={GUTTER - 10} y={y(l.band[0]) - 5} textAnchor="end" fontSize={11} className="font-mono" fill={LEVEL_HEX[l.id]}>
            {l.id}
          </text>
          <text x={GUTTER - 10} y={y(l.band[0]) + 8} textAnchor="end" fontSize={10} className="fill-slate-500 font-mono uppercase" letterSpacing="0.12em">
            {l.name}
          </text>
        </g>
      ))}

      {/* Climbers — one column per dimension: rope, previous-scan marker, current marker, labels. */}
      {facts.map((f, i) => {
        const x = cx(i);
        const color = scoreHex(f.d.score);
        const selected = f.id === selectedId;
        const prev = f.delta !== null ? f.d.score - f.delta : null;
        const ropeLen = y(0) - y(f.d.score);
        const delay = `${Math.min(i * 60, 480)}ms`;
        const label = `${f.id} ${f.short}: ${f.d.score}, ${f.level.name}${f.delta !== null ? `, ${f.delta >= 0 ? "+" : ""}${f.delta} since last scan` : ""}`;
        return (
          <g
            key={f.id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={label}
            className="focus-ring cursor-pointer outline-none"
            onClick={() => onSelect(f.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <rect x={x - colW / 2} y={PAD_TOP} width={colW} height={PLOT_H + PAD_BOTTOM - 4} fill="var(--color-accent)" opacity={selected ? 0.08 : 0} rx={6} />
            <line
              x1={x}
              x2={x}
              y1={y(0)}
              y2={y(f.d.score)}
              stroke={color}
              strokeWidth={selected ? 3 : 2}
              strokeLinecap="round"
              strokeDasharray={ropeLen}
              strokeDashoffset={drawn ? 0 : ropeLen}
              style={reduced ? undefined : { transition: `stroke-dashoffset 0.7s ease-out ${delay}` }}
            />
            {prev !== null && f.delta !== 0 && (
              <g opacity={drawn ? 1 : 0} style={reduced ? undefined : { transition: `opacity 0.4s ease-out calc(${delay} + 0.5s)` }}>
                <line x1={x} x2={x} y1={y(prev)} y2={y(f.d.score)} stroke={deltaHex(f.delta!)} strokeWidth={1.5} strokeDasharray="2 3" />
                <circle cx={x} cy={y(prev)} r={3.5} fill="var(--color-surface-strong)" className="stroke-slate-500" strokeWidth={1.25} />
              </g>
            )}
            <circle
              cx={x}
              cy={y(f.d.score)}
              r={selected ? 7 : 5}
              fill={color}
              stroke="var(--color-ink)"
              strokeWidth={1.5}
              opacity={drawn ? 1 : 0}
              style={reduced ? undefined : { transition: `opacity 0.3s ease-out calc(${delay} + 0.45s), r 0.15s ease-out` }}
            />
            <text x={x} y={y(f.d.score) - 12} textAnchor="middle" fontSize={12} fontWeight={700} className="font-mono" fill={color} opacity={drawn ? 1 : 0}>
              {f.d.score}
            </text>
            <text x={x} y={H - 22} textAnchor="middle" fontSize={11} className={`font-mono ${selected ? "fill-white" : "fill-slate-400"}`}>
              {f.id} <tspan aria-hidden>{scoreGlyph(f.d.score)}</tspan>
            </text>
            <text x={x} y={H - 8} textAnchor="middle" fontSize={10} className={`font-mono uppercase ${selected ? "fill-slate-200" : "fill-slate-500"}`} letterSpacing="0.08em">
              {f.short}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
