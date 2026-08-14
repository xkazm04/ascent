// Shared presentational pieces for the tech-stacks dimension analysis — the class pill, the 0→100
// range bar, the first-sight note, the change-type tag, and the diagnosis row. Extracted so the
// segmented baseline and both combined variants render the SAME diagnosis language (one place to
// tune). No hooks → server-safe, but freely imported by the client variants.

import type { ReactNode } from "react";
import { scoreHex } from "@/lib/ui";
import { coverageOf, type DimClass, type DimInsight } from "@/components/org/fleet/tech-stacks/fleetAnalysis";
import type { ChangeType } from "@/components/org/fleet/tech-stacks/transferPlaybook";

export const CLASS_META: Record<DimClass, { color: string; icon: string; label: string }> = {
  divergent: { color: "#eab308", icon: "⇄", label: "Divergent" },
  gap: { color: "#f97316", icon: "▼", label: "Gap" },
  strength: { color: "#22c55e", icon: "▲", label: "Strength" },
  consistent: { color: "#64748b", icon: "≈", label: "Consistent" },
};

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

/** Neutral ink used to de-weight a low-coverage verdict — the same slate the "consistent" (no-signal)
 *  class already reads in, so a minority read never borrows the full-coverage class colour. */
const MUTED = CLASS_META.consistent.color;

/** `muted` de-weights the pill to neutral ink for a low-coverage verdict. The verdict itself is
 *  unchanged and still fully legible — only its visual emphasis is withdrawn. */
export function ClassPill({ klass, muted }: { klass: DimClass; muted?: boolean }) {
  const m = CLASS_META[klass];
  const color = muted ? MUTED : m.color;
  return (
    <span
      className="inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs"
      style={{ backgroundColor: `${color}1f`, color }}
    >
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  );
}

/**
 * What the verdict rests on: contributing stacks out of the scored total. The analysis has always
 * computed this (DimInsight.count) and every surface threw it away before render, so a "divergent"
 * drawn from 2 of 8 stacks looked exactly like one drawn from all 8. Mono `tabular-nums` per the brand;
 * a low-coverage read says so in words as well as tone, so the signal isn't colour-only.
 */
export function CoverageChip({ d, nounPlural = "stacks" }: { d: DimInsight; nounPlural?: string }) {
  const c = coverageOf(d);
  const low = c.level === "low";
  return (
    <span
      className={`font-mono text-xs tabular-nums ${low ? "text-warn" : "text-slate-500"}`}
      title={`This verdict is drawn from ${c.count} of the ${c.of} scored ${nounPlural} that could carry this dimension.`}
    >
      {c.count}/{c.of} {nounPlural}
      {low ? " · low coverage" : ""}
    </span>
  );
}

export function ChangeTag({ type }: { type: ChangeType }) {
  return (
    <span className="rounded border border-divider bg-surface/60 px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide text-slate-400">
      {type}
    </span>
  );
}

/** A first-sight, plain-language read of the row — where the debt is and what the gap means. */
export function noteFor(d: DimInsight) {
  const strong = "font-medium text-slate-200";
  switch (d.klass) {
    case "divergent":
      return (
        <>
          <span className={strong}>{d.laggard.name}</span> is <span className={strong}>{d.spread} pts</span> behind{" "}
          <span className={strong}>{d.leader.name}</span>; the practice hasn&apos;t transferred.
        </>
      );
    case "gap":
      return (
        <>
          Fleet-wide gap: even <span className={strong}>{d.leader.name}</span>, the strongest, reaches only{" "}
          <span className={strong}>{d.max}</span>.
        </>
      );
    case "strength":
      return (
        <>
          Every stack scores <span className={strong}>≥ {d.min}</span>, a shared strength to hold.
        </>
      );
    default:
      return (
        <>
          All stacks cluster near <span className={strong}>{d.mean}</span>, no outlier.
        </>
      );
  }
}

/** The 0→100 range track: quarter gridlines, fleet baseline tick, the min→max spread bar, and the
 *  laggard (hollow) / leader (filled) dots. `compact` shrinks it for card headers. */
export function RangeBar({ d, compact }: { d: DimInsight; compact?: boolean }) {
  // A minority-coverage spread is drawn in neutral ink: the bar still shows the full min→max range,
  // it just stops asserting the class colour it can't fully evidence.
  const m = coverageOf(d).level === "low" ? CLASS_META.consistent : CLASS_META[d.klass];
  return (
    <div className={`relative ${compact ? "h-5" : "h-8"}`}>
      {[25, 50, 75].map((g) => (
        <div key={g} className="absolute inset-y-1 w-px bg-divider/70" style={{ left: `${g}%` }} />
      ))}
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
        style={{ left: `${d.min}%`, width: `${Math.max(0, d.spread)}%`, backgroundColor: `${m.color}40` }}
      />
      {d.fleet != null && (
        <div className="absolute inset-y-0 w-px bg-slate-400/70" style={{ left: `${clampPct(d.fleet)}%` }} title={`Whole-fleet baseline: ${d.fleet}`} />
      )}
      <span
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-ink"
        style={{ left: `${clampPct(d.laggard.value)}%`, borderColor: scoreHex(d.laggard.value) }}
        title={`${d.laggard.name} · ${d.laggard.value} (laggard)`}
      />
      <span
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink"
        style={{ left: `${clampPct(d.leader.value)}%`, backgroundColor: scoreHex(d.leader.value) }}
        title={`${d.leader.name} · ${d.leader.value} (leader)`}
      />
    </div>
  );
}

/** The leader/laggard readout used in the diagnosis row's right column. */
export function LeaderLaggard({ d }: { d: DimInsight }) {
  return (
    <div className="font-mono text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-slate-300" title={d.leader.name}>{d.leader.name}</span>
        <span className="tabular-nums" style={{ color: scoreHex(d.leader.value) }}>{d.leader.value}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-slate-500" title={d.laggard.name}>{d.laggard.name}</span>
        <span className="tabular-nums" style={{ color: scoreHex(d.laggard.value) }}>{d.laggard.value}</span>
      </div>
    </div>
  );
}

/** The full diagnosis row (label + class, range + note, leader/laggard + an action slot), with an
 *  optional expanded body beneath it. Shared by the segmented baseline and the Playbook variant. */
export function ConsensusRow({ d, action, nounPlural, children }: { d: DimInsight; action?: ReactNode; nounPlural?: string; children?: ReactNode }) {
  return (
    <div className="py-2.5">
      <div className="grid grid-cols-[8.5rem_minmax(0,1fr)_11.5rem] items-start gap-4">
        <div className="flex flex-col items-start gap-1">
          <span className="font-medium text-white">{d.label}</span>
          <ClassPill klass={d.klass} muted={coverageOf(d).level === "low"} />
          <CoverageChip d={d} nounPlural={nounPlural} />
        </div>
        <div>
          <RangeBar d={d} />
          <p className="mt-1 text-sm text-slate-400">{noteFor(d)}</p>
        </div>
        <div className="min-w-0">
          <LeaderLaggard d={d} />
          {action && <div className="mt-1">{action}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}
