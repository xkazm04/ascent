"use client";

// The Dimensions explorer — the per-dimension breakdown, redesigned for density. One component pairs
// the radar with a compact, clickable score-bar list (selection synced both ways); a single switchable
// detail panel below shows the selected dimension's evidence / gaps / trend / provenance. This replaces
// the old "radar + nine always-expanded cards" stack, which was the heaviest part of the report.

import { useState } from "react";
import type { DimensionId, ScanReport } from "@/lib/types";
import { scoreGlyph, scoreHex } from "@/lib/ui";
import { fillBarStyle, useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import type { TrendPoint } from "@/components/report/TrendChart";
import { RadarChart } from "@/components/report/RadarChart";
import { DimensionDetail } from "@/components/report/DimensionDetail";
import { Surface } from "@/components/ui";

export function DimensionExplorer({
  report,
  prevDimScores,
  dimSeries,
}: {
  report: ScanReport;
  prevDimScores: Map<string, number> | null;
  dimSeries: Map<string, TrendPoint[]> | null;
}) {
  const dims = report.dimensions;
  const [selectedId, setSelectedId] = useState<DimensionId>(dims[0]!.id);
  const selected = dims.find((d) => d.id === selectedId) ?? dims[0]!;
  const reduced = usePrefersReducedMotion();
  const mounted = useMounted();

  return (
    <section aria-label="Dimensions" data-testid="report-tab-dimensions" className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Dimension breakdown</h2>
        <p className="mt-1 text-base text-slate-400">
          Nine weighted dimensions on a 0–100 scale. Pick one — on the radar or in the list — to read its
          evidence, gaps, and how the deterministic signal and the AI judgment blended into the score.
        </p>
      </div>

      {/* Chart + bars in one component. The radar's selected vertex and the highlighted bar stay in sync. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Surface radius="2xl" className="flex items-center justify-center p-4">
          <RadarChart dimensions={dims} highlightId={selectedId} onSelect={setSelectedId} />
        </Surface>
        <div className="space-y-1.5" aria-label="Dimension scores">
          {dims.map((d, i) => (
            <DimBar
              key={d.id}
              d={d}
              index={i}
              selected={d.id === selectedId}
              onSelect={() => setSelectedId(d.id)}
              prevScore={prevDimScores?.get(d.id)}
              mounted={mounted}
              reduced={reduced}
            />
          ))}
        </div>
      </div>

      {/* Switchable detail — keyed on the selection so it cross-fades in on every pick. */}
      <Surface radius="2xl" className="p-5">
        <div key={selectedId} className="animate-fade-in">
          <DimensionDetail
            d={selected}
            prevScore={prevDimScores?.get(selectedId)}
            series={dimSeries?.get(selectedId)}
          />
        </div>
      </Surface>
    </section>
  );
}

/** One selectable score bar — label, weight, since-last delta, score, and a mount-filled meter. The
 *  selected row carries an accent wash + left rail marker (mirrors the SideNav active treatment). */
function DimBar({
  d,
  index,
  selected,
  onSelect,
  prevScore,
  mounted,
  reduced,
}: {
  d: ScanReport["dimensions"][number];
  index: number;
  selected: boolean;
  onSelect: () => void;
  prevScore?: number;
  mounted: boolean;
  reduced: boolean;
}) {
  const color = scoreHex(d.score);
  const delta = prevScore !== undefined ? d.score - prevScore : null;
  const { width, transition } = fillBarStyle({ pct: d.score, index, mounted, reduced });

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "focus-ring relative w-full rounded-lg border px-3 py-2 text-left transition " +
        (selected
          ? "border-accent/40 bg-accent/10 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
          : "border-transparent hover:border-divider hover:bg-surface/60")
      }
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-slate-500">{d.id}</span>
        <span className={`flex-1 truncate font-semibold ${selected ? "text-white" : "text-slate-200"}`}>{d.name}</span>
        {delta !== null && delta !== 0 && (
          <span className={`text-sm font-semibold ${delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
            {delta > 0 ? "▲+" : "▼"}
            {delta}
          </span>
        )}
        <span className="text-sm text-slate-500">{Math.round(d.weight * 100)}%</span>
        <span className="flex w-12 items-center justify-end gap-1 text-base font-bold tabular-nums" style={{ color }}>
          <span aria-hidden className="text-xs">{scoreGlyph(d.score)}</span>
          {d.score}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full" style={{ width, backgroundColor: color, transition }} />
      </div>
    </button>
  );
}
