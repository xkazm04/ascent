// The diagnosis row, composition. Same DimInsight and the same verdict language as analysisShared.tsx
// (CLASS_META labels and glyphs, coverageOf, noteFor), drawn without hue: a class is its glyph and word, the
// range track is paper and hairline (leader filled, laggard hollow, fleet baseline a tick). Server-safe.
import type { ReactNode } from "react";
import { coverageOf, type DimClass, type DimInsight } from "./fleetAnalysis";
import { CLASS_META, noteFor } from "./analysisShared";

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

export function ClassWord({ klass, muted }: { klass: DimClass; muted?: boolean }) {
  const m = CLASS_META[klass];
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 type-caption ${muted ? "text-slate-400" : "text-white"}`}>
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  );
}

export function DimCoverage({ d, nounPlural = "stacks" }: { d: DimInsight; nounPlural?: string }) {
  const c = coverageOf(d);
  const low = c.level === "low";
  return (
    <span className="type-caption tabular-nums text-slate-400" title={`This verdict is drawn from ${c.count} of the ${c.of} scored ${nounPlural} that could carry this dimension.`}>
      {c.count}/{c.of} {nounPlural}
      {low ? " · low coverage" : ""}
    </span>
  );
}

export function RangeTrack({ d }: { d: DimInsight }) {
  return (
    <div className="relative h-7 w-1/2">
      {[25, 50, 75].map((g) => (
        <div key={g} className="absolute inset-y-1.5 w-px bg-divider" style={{ left: `${g}%` }} />
      ))}
      <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-[2px] bg-slate-500/60" style={{ left: `${d.min}%`, width: `${Math.max(0, d.spread)}%` }} />
      {d.fleet != null && <div className="absolute inset-y-0 w-px bg-slate-300" style={{ left: `${clampPct(d.fleet)}%` }} title={`Whole-fleet baseline: ${d.fleet}`} />}
      <span
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-ink"
        style={{ left: `${clampPct(d.laggard.value)}%` }}
        title={`${d.laggard.name} · ${d.laggard.value} (laggard)`}
      />
      <span
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-ink"
        style={{ left: `${clampPct(d.leader.value)}%` }}
        title={`${d.leader.name} · ${d.leader.value} (leader)`}
      />
    </div>
  );
}

export function ConsensusRowView({ d, action, nounPlural, children }: { d: DimInsight; action?: ReactNode; nounPlural?: string; children?: ReactNode }) {
  return (
    <div className="py-4">
      <div className="grid grid-cols-[8.5rem_minmax(0,1fr)_12rem] items-start gap-5">
        <div className="flex flex-col items-start gap-1">
          <span className="font-semibold text-white">{d.label}</span>
          <ClassWord klass={d.klass} muted={coverageOf(d).level === "low"} />
          <DimCoverage d={d} nounPlural={nounPlural} />
        </div>
        <div>
          <RangeTrack d={d} />
          <p className="mt-1 type-body-sm text-slate-300">{noteFor(d)}</p>
        </div>
        <div className="min-w-0 type-caption">
          <div className="flex items-baseline justify-between gap-2 text-slate-200">
            <span className="truncate" title={d.leader.name}>{d.leader.name}</span>
            <span className="tabular-nums text-white">{d.leader.value}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-slate-400">
            <span className="truncate" title={d.laggard.name}>{d.laggard.name}</span>
            <span className="tabular-nums">{d.laggard.value}</span>
          </div>
          {action && <div className="mt-1">{action}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}
