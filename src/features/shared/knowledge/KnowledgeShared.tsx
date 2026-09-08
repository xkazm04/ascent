"use client";

// Pieces every variant renders: a matrix cell, the state legend, a repo's stage chip, a spectrum
// bar, the sweep strip and the domain picker. Hoisted here the moment two variants needed them —
// the metaphors differ in LAYOUT, not in how a verdict is drawn.

import { Kicker } from "@/components/ui";
import { chipButtonClass } from "@/components/ui";
import type { KnowledgeCell, KnowledgeCellState, KnowledgeDomain, KnowledgeRepo, KnowledgeView } from "@/lib/org/knowledge-shape";
import {
  ABSENCE_STATES,
  STAGE_LABEL,
  STATE_CLASS,
  STATE_GLYPH,
  STATE_LABEL,
  type StateCounts,
  VERDICT_STATES,
  sweepAge,
} from "./knowledgeModel";

/** One cell: a button when it can be picked into a brief, a swatch otherwise. Evidence rides in the title. */
export function CellButton({
  cell,
  repo,
  picked,
  onPick,
  size = "md",
}: {
  cell: KnowledgeCell;
  repo: string;
  picked?: boolean;
  onPick?: () => void;
  size?: "sm" | "md";
}) {
  const pickable = !!onPick && (cell.state === "unknown" || cell.state === "deviation" || cell.state === "candidate" || cell.stale);
  const title = `${repo} · ${cell.subject} — ${STATE_LABEL[cell.state]}${cell.stale ? " (stale: judged against an older standard)" : ""}${
    cell.contexts ? ` · ${cell.contexts} context${cell.contexts === 1 ? "" : "s"}` : ""
  }${cell.evidence ? `\n${cell.evidence}` : ""}`;
  const box = size === "sm" ? "h-5 w-5 type-micro" : "h-7 w-11 type-mono-sm";
  const ring = picked ? "ring-2 ring-accent ring-inset" : "";
  const stale = cell.stale ? "underline decoration-dotted underline-offset-2" : "";
  const cls = `focus-ring flex ${box} items-center justify-center gap-1 font-mono ${STATE_CLASS[cell.state]} ${ring} ${stale}`;
  // A judged cell carries its context count beside the glyph — the fold hides N rows behind one
  // state, and the number says how many. Absences are glyph-only: nothing is folded there.
  const face = (
    <>
      {STATE_GLYPH[cell.state]}
      {cell.contexts > 0 && size === "md" ? <span className="text-[10px] tabular-nums text-slate-500">{cell.contexts}</span> : null}
    </>
  );
  if (!pickable) {
    return (
      <span className={cls} title={title} aria-label={title}>
        {face}
      </span>
    );
  }
  return (
    <button type="button" className={`${cls} hover:ring-1 hover:ring-accent/60 hover:ring-inset`} title={title} aria-pressed={picked} onClick={onPick}>
      {face}
    </button>
  );
}

const legendItem = (s: KnowledgeCellState) => (
  <span key={s} className="inline-flex items-center gap-1.5">
    <span className={`inline-flex h-4 w-4 items-center justify-center font-mono type-micro ${STATE_CLASS[s]}`}>{STATE_GLYPH[s]}</span>
    <span>{STATE_LABEL[s]}</span>
  </span>
);

/** Verdicts on one line, absences on the next — two halves of one vocabulary, never mixed. */
export function StateLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div className="space-y-1 type-caption text-slate-500">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="text-slate-600">verdicts</span>
        {VERDICT_STATES.map(legendItem)}
      </div>
      {compact ? null : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="text-slate-600">absences</span>
          {ABSENCE_STATES.map(legendItem)}
        </div>
      )}
    </div>
  );
}

const STAGE_TONE: Record<KnowledgeRepo["stage"], string> = {
  populate: "border-accent/60 text-accent",
  map: "border-accent/60 text-accent",
  conform: "border-slate-500 text-slate-200",
  current: "border-slate-700 text-slate-500",
};

export function StageChip({ stage, className = "" }: { stage: KnowledgeRepo["stage"]; className?: string }) {
  return (
    <span className={`inline-flex rounded-md border px-1.5 py-0.5 type-micro uppercase tracking-[0.16em] ${STAGE_TONE[stage]} ${className}`}>
      {STAGE_LABEL[stage]}
    </span>
  );
}

/** A proportional bar of states, worst first — the shape of a repo or a subject in one glance. */
export function Spectrum({ counts, className = "w-full" }: { counts: StateCounts; /** Width class — the caller owns it (a `w-14` beside a `w-full` would race in the cascade). */ className?: string }) {
  const order: KnowledgeCellState[] = [...VERDICT_STATES, ...ABSENCE_STATES];
  const total = order.reduce((n, s) => n + counts[s], 0) || 1;
  return (
    <div className={`flex h-1.5 shrink-0 overflow-hidden rounded-sm bg-divider ${className}`} aria-hidden>
      {order.map((s) =>
        counts[s] ? <span key={s} className={STATE_CLASS[s].split(" ")[0]} style={{ width: `${(counts[s] / total) * 100}%` }} /> : null,
      )}
    </div>
  );
}

/** Sweep age is the instrument's calibration date — always visible, loud when "never". */
export function SweepStrip({ view, onSweep, pending = false }: { view: KnowledgeView; onSweep?: () => void; pending?: boolean }) {
  const never = !view.sweep.lastAt;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-divider bg-surface/40 px-4 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Kicker tone="muted" as="span">
          Fleet sweep
        </Kicker>
        <span className={`type-mono-sm ${never ? "text-accent" : "text-slate-300"}`}>{never ? "never run" : sweepAge(view.sweep.lastAt)}</span>
        {view.sweep.warnings.length ? (
          <span className="type-caption text-slate-500" title={view.sweep.warnings.join("\n")}>
            {view.sweep.warnings.length} warning{view.sweep.warnings.length === 1 ? "" : "s"}
          </span>
        ) : null}
        {view.sweep.truncated ? <span className="type-caption text-slate-500">pair list truncated</span> : null}
      </div>
      {view.capabilities.canSweep ? (
        <button type="button" className={chipButtonClass("idle", "disabled:opacity-50")} onClick={onSweep} disabled={pending}>
          {pending ? "Sweeping…" : "Sweep fleet"}
        </button>
      ) : null}
    </div>
  );
}

export function DomainPicker({ domains, active, onPick }: { domains: KnowledgeDomain[]; active: string; onPick: (d: string) => void }) {
  if (domains.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Knowledge bundle">
      {domains.map((d) => (
        <button
          key={d.name}
          type="button"
          role="tab"
          aria-selected={d.name === active}
          className={chipButtonClass(d.name === active ? "success" : "idle")}
          onClick={() => onPick(d.name)}
        >
          {d.title}
          <span className="font-mono tabular-nums text-slate-500">{d.subjects}</span>
        </button>
      ))}
    </div>
  );
}
