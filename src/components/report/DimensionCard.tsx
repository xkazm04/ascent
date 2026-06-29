"use client";

import { useState } from "react";
import type { ScanReport } from "@/lib/types";
import { LLM_GUARDBAND } from "@/lib/maturity/model";
import { scoreGlyph, scoreHex } from "@/lib/ui";
import { fillBarStyle, useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { linScale } from "@/components/report/chartScale";
import { Sparkline, type TrendPoint } from "@/components/report/TrendChart";
import { DeltaTag } from "@/components/report/deltas";
import { Surface } from "@/components/ui";

export function DimensionCard({
  d,
  index = 0,
  prevScore,
  series,
}: {
  d: ScanReport["dimensions"][number];
  index?: number;
  prevScore?: number;
  series?: TrendPoint[];
}) {
  const [open, setOpen] = useState(false);
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();
  const color = scoreHex(d.score);
  const delta = prevScore !== undefined ? d.score - prevScore : null;

  // One motion language (reuses animate-fade-up's ease-out): the score-fill grows from 0 on
  // mount with a small per-row stagger; the detail panel is a height+opacity accordion; the
  // chevron rotates 90°. prefers-reduced-motion snaps everything to its final state instead.
  const { width: fillWidth, transition: fillTransition } = fillBarStyle({ pct: d.score, index, mounted, reduced });
  const detailTransition = reduced ? undefined : "grid-template-rows 0.3s ease-out, opacity 0.3s ease-out";
  const chevronTransition = reduced ? undefined : "transform 0.3s ease-out";

  return (
    <Surface radius="xl" className="p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="font-mono text-sm text-slate-500">{d.id}</span>
        <span className="flex-1 font-semibold text-white">{d.name}</span>
        {delta !== null && <DeltaTag delta={delta} hideZero />}
        <span className="text-sm text-slate-500">{Math.round(d.weight * 100)}%</span>
        <span className="flex w-14 items-center justify-end gap-1 text-lg font-bold" style={{ color }}>
          <span aria-hidden className="text-sm">{scoreGlyph(d.score)}</span>
          {d.score}
        </span>
        <span
          aria-hidden
          className="inline-block text-slate-500"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: chevronTransition }}
        >
          ▸
        </span>
      </button>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full" style={{ width: fillWidth, backgroundColor: color, transition: fillTransition }} />
      </div>
      <div
        className="grid"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0, transition: detailTransition }}
      >
        <div className="overflow-hidden" aria-hidden={!open}>
          <div className="mt-3 space-y-3 text-base">
            {d.summary && <p className="leading-relaxed text-slate-300">{d.summary}</p>}
            {d.evidence.length > 0 && (
              <div>
                <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Evidence</div>
                <ul className="mt-1 space-y-1 text-slate-400">
                  {d.evidence.map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-slate-600">·</span>
                      <span>{e}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {d.gaps.length > 0 && (
              <div className="text-slate-400">
                <span className="text-sm font-semibold uppercase tracking-wide text-amber-400/80">Gaps: </span>
                {d.gaps.join(" · ")}
              </div>
            )}
            {series && series.length >= 2 && (
              <div className="flex items-center gap-3 border-t border-divider pt-2">
                <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">Trend</span>
                <Sparkline points={series} />
                <span className="text-sm text-slate-500">
                  {series[0]!.score} → {series[series.length - 1]!.score}
                </span>
              </div>
            )}
            <ProvenanceTrack signal={d.signalScore} llm={d.llmScore} blended={d.score} />
          </div>
        </div>
      </div>
    </Surface>
  );
}

/**
 * Score provenance micro-viz — makes the deterministic-signal + guardbanded-LLM blend
 * auditable instead of a black box. A shaded ±LLM_GUARDBAND zone is centered on the signal
 * score; ticks mark the signal and the (clamped) LLM judgment; a filled bar runs to the
 * blended result. Zero-dependency inline SVG over a 0..100 scale, like Charts.tsx.
 */
function ProvenanceTrack({ signal, llm, blended }: { signal: number; llm: number; blended: number }) {
  const W = 240;
  const H = 22;
  const padX = 2;
  const trackY = 14;
  const x = linScale(100, padX, W - padX * 2);
  const bandLo = Math.max(0, signal - LLM_GUARDBAND);
  const bandHi = Math.min(100, signal + LLM_GUARDBAND);
  const color = scoreHex(blended);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full" role="img" aria-label={`Score provenance: signal ${signal}, LLM ${llm}, blended ${blended}`}>
      {/* baseline track */}
      <line x1={x(0)} x2={x(100)} y1={trackY} y2={trackY} stroke="#1e293b" strokeWidth={3} strokeLinecap="round" />
      {/* ±guardband zone around the signal */}
      <rect x={x(bandLo)} y={trackY - 4} width={x(bandHi) - x(bandLo)} height={8} rx={2} fill="#3b9eff" opacity={0.14}>
        {/* Single template-literal child: React 19 special-cases <title> as metadata and only renders a
            lone text child — mixed text+number children make it drop on the server but render on the
            client (a hydration mismatch). Keep every SVG <title> a single string. */}
        <title>{`Guardband: the LLM can move the score at most ±${LLM_GUARDBAND} from the signal`}</title>
      </rect>
      {/* filled bar from signal → blended result */}
      <line x1={x(signal)} x2={x(blended)} y1={trackY} y2={trackY} stroke={color} strokeWidth={3} strokeLinecap="round" />
      {/* signal tick */}
      <g>
        <line x1={x(signal)} x2={x(signal)} y1={trackY - 6} y2={trackY + 6} stroke="#94a3b8" strokeWidth={2} />
        <title>{`Signal (deterministic): ${signal}`}</title>
      </g>
      {/* llm tick */}
      <g>
        <circle cx={x(llm)} cy={trackY} r={3} fill="#cbd5e1" stroke="#0f172a" strokeWidth={1} />
        <title>{`LLM judgment: ${llm}`}</title>
      </g>
      {/* blended marker */}
      <g>
        <circle cx={x(blended)} cy={trackY} r={3.5} fill={color} stroke="#020617" strokeWidth={1} />
        <title>{`Blended result: ${blended}`}</title>
      </g>
      {/* The numeric values are intentionally not drawn into this 22px-tall track — a 7px legend
          failed both legibility and contrast. They're conveyed by the svg aria-label
          (signal/llm/blended), the per-element <title> tooltips, and the tick/marker positions. */}
    </svg>
  );
}
