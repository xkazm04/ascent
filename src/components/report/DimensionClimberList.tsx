"use client";

// The climber list — the index half of the Dimensions explorer. One typeset line per dimension
// (id · name · level · weighted headroom meter · since-last delta · score), selection synced with
// the elevation gauge, and a sort strip (rubric order / by score / by lever) that reorders BOTH the
// list and the gauge's columns. The headroom meter is the lever: how many overall points this
// dimension still has in reach, which is what a reader deciding where to invest actually needs.

import { scoreGlyph, scoreHex } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";
import { fillBarStyle } from "@/components/report/chartMotion";
import { ScoreBarTrack } from "@/components/report/FillBar";
import type { DimFacts } from "@/components/report/dimensionExplorerDerive";
import { Kicker, chipButtonClass, deltaHex, fmtDelta } from "@/components/ui";

export type ClimberSort = "rubric" | "score" | "lever";
const SORTS: { key: ClimberSort; label: string }[] = [
  { key: "rubric", label: "Rubric" },
  { key: "score", label: "Score" },
  { key: "lever", label: "Lever" },
];

export function sortClimbers(facts: DimFacts[], key: ClimberSort): DimFacts[] {
  if (key === "score") return [...facts].sort((a, b) => b.d.score - a.d.score);
  if (key === "lever") return [...facts].sort((a, b) => b.headroom - a.headroom);
  return facts;
}

export function DimensionClimberList({
  facts,
  selectedId,
  onSelect,
  sort,
  onSort,
  mounted,
  reduced,
}: {
  /** Already sorted — the same order the gauge draws. */
  facts: DimFacts[];
  selectedId: DimensionId;
  onSelect: (id: DimensionId) => void;
  sort: ClimberSort;
  onSort: (s: ClimberSort) => void;
  mounted: boolean;
  reduced: boolean;
}) {
  const maxHeadroom = Math.max(0, ...facts.map((f) => f.headroom));
  return (
    <div className="space-y-2" aria-label="Dimension scores">
      <div className="flex items-center justify-between gap-3 px-1">
        <Kicker tone="muted">In reach = overall pts if this hit 100</Kicker>
        <div className="flex gap-1" role="group" aria-label="Sort dimensions">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={sort === s.key}
              onClick={() => onSort(s.key)}
              className={chipButtonClass("idle", `px-2 py-0.5 ${sort === s.key ? "border-accent text-white" : ""}`)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        {facts.map((f, i) => (
          <ClimberRow key={f.id} f={f} index={i} selected={f.id === selectedId} onSelect={() => onSelect(f.id)} maxHeadroom={maxHeadroom} mounted={mounted} reduced={reduced} />
        ))}
      </div>
    </div>
  );
}

function ClimberRow({
  f,
  index,
  selected,
  onSelect,
  maxHeadroom,
  mounted,
  reduced,
}: {
  f: DimFacts;
  index: number;
  selected: boolean;
  onSelect: () => void;
  maxHeadroom: number;
  mounted: boolean;
  reduced: boolean;
}) {
  const color = scoreHex(f.d.score);
  const pct = maxHeadroom > 0 ? (f.headroom / maxHeadroom) * 100 : 0;
  const meter = fillBarStyle({ pct, index, mounted, reduced });
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`focus-ring relative grid w-full grid-cols-[2.5rem_minmax(0,1fr)_5.5rem_3.5rem_3.5rem] items-center gap-x-3 rounded-lg border px-3 py-2 text-left transition ${
        selected
          ? "border-accent/40 bg-accent/10 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
          : "border-transparent hover:border-divider hover:bg-surface/60"
      }`}
    >
      <span className="type-mono-sm text-slate-500">{f.id}</span>
      <span className="min-w-0">
        <span className={`block truncate font-semibold ${selected ? "text-white" : "text-slate-200"}`}>{f.d.name}</span>
        <span className="type-label tracking-[0.16em]" style={{ color }}>
          {f.level.id} {f.level.name}
        </span>
      </span>
      <span className="flex items-center gap-2" title={`+${f.headroom.toFixed(1)} overall points in reach`}>
        <ScoreBarTrack className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-accent/70" style={meter} />
        </ScoreBarTrack>
        <span className="w-8 type-mono-sm tabular-nums text-slate-400">+{f.headroom.toFixed(1)}</span>
      </span>
      <span className="type-mono-sm tabular-nums text-right" style={f.delta !== null ? { color: deltaHex(f.delta) } : undefined}>
        {f.delta !== null ? fmtDelta(f.delta) : <span className="text-slate-600">—</span>}
      </span>
      <span className="flex items-center justify-end gap-1 type-figure font-bold tabular-nums" style={{ color }}>
        <span aria-hidden className="type-note">{scoreGlyph(f.d.score)}</span>
        {f.d.score}
      </span>
    </button>
  );
}
