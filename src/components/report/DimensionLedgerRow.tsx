"use client";

// One row of the dimension ledger — a typeset line in the index: id · name/axis · weight · detector
// and model readings · headroom meter (overall points still in reach) · since-last delta · score.
// The row is the expand toggle; the detail body renders under it inside the same hairline frame.

import type { ReactNode } from "react";
import { scoreGlyph, scoreHex } from "@/lib/ui";
import { fillBarStyle } from "@/components/report/chartMotion";
import { ScoreBarFill, ScoreBarTrack } from "@/components/report/FillBar";
import { Sparkline, type TrendPoint } from "@/components/report/TrendChart";
import type { DimFacts } from "@/components/report/dimensionExplorerDerive";
import { deltaHex, fmtDelta } from "@/components/ui";

/** Column template shared by the header row and every ledger row so the figures align as a table. */
export const LEDGER_COLS =
  "grid-cols-[2.5rem_minmax(0,1fr)_3.5rem_4.5rem] md:grid-cols-[2.5rem_minmax(0,1fr)_3.5rem_3.5rem_3.5rem_9rem_7rem_4rem_4.5rem]";

export function DimensionLedgerRow({
  f,
  index,
  expanded,
  onToggle,
  series,
  maxHeadroom,
  mounted,
  reduced,
  children,
}: {
  f: DimFacts;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  series?: TrendPoint[];
  maxHeadroom: number;
  mounted: boolean;
  reduced: boolean;
  children: ReactNode;
}) {
  const color = scoreHex(f.d.score);
  const modelIgnored = f.provenance.kind !== "blended";
  const headroomPct = maxHeadroom > 0 ? (f.headroom / maxHeadroom) * 100 : 0;
  const { transition } = fillBarStyle({ pct: headroomPct, index, mounted, reduced });

  return (
    <div className="bg-ink">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`focus-ring grid w-full items-center gap-x-3 px-4 py-3 text-left transition ${LEDGER_COLS} ${
          expanded ? "bg-accent/[0.06]" : "hover:bg-surface/60"
        }`}
      >
        <span className="type-mono-sm text-slate-500">{f.id}</span>
        <span className="min-w-0">
          <span className={`block truncate font-semibold ${expanded ? "text-white" : "text-slate-200"}`}>{f.d.name}</span>
          <span className="type-label tracking-[0.18em] text-slate-500">
            {f.axis} · {f.level.id} {f.level.name}
          </span>
        </span>
        <span className="type-mono-sm tabular-nums text-slate-400">{Math.round(f.d.weight * 100)}%</span>
        <span className="hidden type-mono-sm tabular-nums text-slate-400 md:block">{f.d.signalScore}</span>
        <span className={`hidden type-mono-sm tabular-nums md:block ${modelIgnored ? "text-slate-600 line-through" : "text-slate-400"}`}>
          {f.d.llmScore}
        </span>
        <span className="hidden items-center gap-2 md:flex" title={`+${f.headroom.toFixed(1)} overall points if this dimension reached 100`}>
          <ScoreBarTrack className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-accent/70" style={{ width: mounted || reduced ? `${headroomPct}%` : "0%", transition }} />
          </ScoreBarTrack>
          <span className="w-10 type-mono-sm tabular-nums text-slate-400">+{f.headroom.toFixed(1)}</span>
        </span>
        <span className="hidden md:block">{series && series.length >= 2 ? <Sparkline points={series} width={96} height={26} /> : <span className="type-mono-sm text-slate-600">—</span>}</span>
        <span className="hidden type-mono-sm tabular-nums md:block" style={f.delta !== null ? { color: deltaHex(f.delta) } : undefined}>
          {f.delta !== null ? fmtDelta(f.delta) : <span className="text-slate-600">—</span>}
        </span>
        <span className="flex items-center justify-end gap-1 type-figure font-bold tabular-nums" style={{ color }}>
          <span aria-hidden className="type-note">{scoreGlyph(f.d.score)}</span>
          {f.d.score}
        </span>
      </button>
      {/* Score meter under the row — the ledger's only bar; the headroom meter above is the lever. */}
      <div className="px-4 pb-2">
        <ScoreBarTrack className="h-px overflow-hidden bg-slate-800">
          <ScoreBarFill pct={f.d.score} color={color} index={index} mounted={mounted} reduced={reduced} />
        </ScoreBarTrack>
      </div>
      {expanded && (
        <div className="animate-expand-down">
          <div className="min-h-0 overflow-hidden">
            <div className="border-t border-divider px-4 py-5">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}
