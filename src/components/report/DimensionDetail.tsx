"use client";

// The per-dimension detail body — summary, evidence, gaps, trend sparkline, and the score-provenance
// micro-viz. Extracted from the old DimensionCard so the new Dimensions explorer (radar + bars + this
// switchable detail) and any future surface render one identical breakdown. Pure presentational.

import type { ScanReport } from "@/lib/types";
import { LLM_GUARDBAND } from "@/lib/maturity/model";
import { scoreHex } from "@/lib/ui";
import { linScale } from "@/components/report/chartScale";
import { Sparkline, type TrendPoint } from "@/components/report/TrendChart";

export function DimensionDetail({
  d,
  prevScore,
  series,
}: {
  d: ScanReport["dimensions"][number];
  prevScore?: number;
  series?: TrendPoint[];
}) {
  const delta = prevScore !== undefined ? d.score - prevScore : null;
  return (
    <div className="space-y-3 text-base">
      {/* Headline row — name + weight + score + since-last delta — so the detail stands on its own
          once a bar selects it (the bar list lives in a separate column above). */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-sm text-slate-500">{d.id}</span>
        <span className="text-lg font-semibold text-white">{d.name}</span>
        <span className="text-sm text-slate-500">weight {Math.round(d.weight * 100)}%</span>
        {delta !== null && delta !== 0 && (
          <span className={`text-sm font-semibold ${delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
            {delta > 0 ? "▲+" : "▼"}
            {delta} since last scan
          </span>
        )}
        <span className="ml-auto text-2xl font-bold tabular-nums" style={{ color: scoreHex(d.score) }}>
          {d.score}
        </span>
      </div>

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
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full max-w-sm" role="img" aria-label={`Score provenance: signal ${signal}, LLM ${llm}, blended ${blended}`}>
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
    </svg>
  );
}
