// The "What changed" panel — renders a ScanDiff (see lib/report/compare.ts) as a story of
// progress between two scans: overall/axis deltas, level & posture transitions, GitHub-style
// red/green dimension cards, gaps that closed vs opened, and recommendations that moved to
// done. Pure presentational (no hooks) so it renders on the server alongside the live picker.

import type { ComparableScan } from "@/lib/db/scans";
import type { DimensionDiff, ScanDiff } from "@/lib/report/compare";
import type { LevelId } from "@/lib/types";
import {
  DIMENSION_SHORT,
  LEVEL_CLASSES,
  LEVEL_GLYPH,
  scoreGlyph,
  scoreHex,
  timeAgo,
} from "@/lib/ui";
import { DeltaPill, DeltaTag } from "@/components/report/deltas";

/** A short, human label for one side of the comparison (score · level · when · engine). */
function scanCaption(scan: ComparableScan): string {
  return `${scan.overallScore} · ${scan.level} · ${timeAgo(scan.scannedAt)} · ${scan.engineProvider}`;
}

/** A level pill (glyph + id · name), colored by the level's brand class. */
function LevelChip({ id, name }: { id: LevelId; name: string }) {
  const lc = LEVEL_CLASSES[id] ?? LEVEL_CLASSES.L1;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border ${lc.border} ${lc.bg} px-2.5 py-1 text-xs font-semibold ${lc.text}`}>
      <span aria-hidden>{LEVEL_GLYPH[id]}</span>
      {id} · {name}
    </span>
  );
}

/** before → after pair with a centered arrow; `changed` mutes the row when nothing moved. */
function Transition({
  label,
  before,
  after,
  changed,
}: {
  label: string;
  before: React.ReactNode;
  after: React.ReactNode;
  changed: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-widest text-slate-500">{label}</span>
        {changed ? (
          <span className="font-mono text-[10px] uppercase tracking-widest text-accent">changed</span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-widest text-slate-600">no change</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {before}
        <span aria-hidden className={changed ? "text-accent" : "text-slate-600"}>
          →
        </span>
        {after}
      </div>
    </div>
  );
}

/** GitHub-style diff bar: neutral base to the unchanged level, then a green (gain) or red
 *  (loss) segment spanning the delta. Falls back to a plain colored bar when a side is absent. */
function DiffBar({ before, after }: { before: number | null; after: number | null }) {
  if (before === null || after === null) {
    const v = after ?? before ?? 0;
    return (
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="h-full" style={{ width: `${v}%`, backgroundColor: scoreHex(v) }} />
      </div>
    );
  }
  const min = Math.min(before, after);
  const max = Math.max(before, after);
  const gain = after >= before;
  return (
    <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div className="absolute inset-y-0 left-0 bg-slate-600" style={{ width: `${min}%` }} />
      <div
        className="absolute inset-y-0"
        style={{ left: `${min}%`, width: `${max - min}%`, backgroundColor: gain ? "#22c55e" : "#ef4444" }}
      />
    </div>
  );
}

function GapList({ title, gaps, tone }: { title: string; gaps: string[]; tone: "closed" | "opened" }) {
  if (gaps.length === 0) return null;
  const good = tone === "closed";
  return (
    <div>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${good ? "text-emerald-400/80" : "text-amber-400/80"}`}>
        {title}
      </div>
      <ul className="mt-1 space-y-1 text-sm">
        {gaps.map((g, i) => (
          <li key={i} className={`flex gap-2 ${good ? "text-emerald-200/90" : "text-amber-200/90"}`}>
            <span aria-hidden className={good ? "text-emerald-400" : "text-amber-400"}>
              {good ? "✓" : "+"}
            </span>
            <span className={good ? "line-through decoration-emerald-700/60" : ""}>{g}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The concrete detector signals that appeared (gained, green) or disappeared (lost, red)
 *  between the two scans — the evidence behind a dimension's score movement. */
function SignalList({ title, signals, tone }: { title: string; signals: string[]; tone: "gained" | "lost" }) {
  if (signals.length === 0) return null;
  const gained = tone === "gained";
  return (
    <div>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${gained ? "text-emerald-400/80" : "text-red-400/80"}`}>
        {title}
      </div>
      <ul className="mt-1 space-y-1 text-sm">
        {signals.map((sig, i) => (
          <li key={i} className={`flex gap-2 ${gained ? "text-emerald-200/90" : "text-red-200/90"}`}>
            <span aria-hidden className={gained ? "text-emerald-400" : "text-red-400"}>
              {gained ? "+" : "−"}
            </span>
            <span>{sig}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DimensionDiffCard({ d }: { d: DimensionDiff }) {
  const afterColor = d.after !== null ? scoreHex(d.after) : "#475569";
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-slate-500">{d.id}</span>
        <span className="flex-1 font-semibold text-white">{d.name}</span>
        {d.delta !== null && <DeltaTag delta={d.delta} />}
        <span className="flex items-center gap-1 font-mono text-sm tabular-nums text-slate-400">
          <span>{d.before ?? "—"}</span>
          <span aria-hidden className="text-slate-600">→</span>
          <span className="flex items-center gap-1 font-bold" style={{ color: afterColor }}>
            <span aria-hidden className="text-xs">{d.after !== null ? scoreGlyph(d.after) : ""}</span>
            {d.after ?? "—"}
          </span>
        </span>
      </div>
      <DiffBar before={d.before} after={d.after} />
      {(d.appearedSignals.length > 0 || d.disappearedSignals.length > 0) && (
        <div className="mt-3 space-y-2">
          <SignalList title="Signals detected" signals={d.appearedSignals} tone="gained" />
          <SignalList title="Signals lost" signals={d.disappearedSignals} tone="lost" />
        </div>
      )}
      {(d.closedGaps.length > 0 || d.openedGaps.length > 0) && (
        <div className="mt-3 space-y-2">
          <GapList title="Resolved" gaps={d.closedGaps} tone="closed" />
          <GapList title="New gaps" gaps={d.openedGaps} tone="opened" />
        </div>
      )}
    </div>
  );
}

export function WhatChanged({
  diff,
  before,
  after,
}: {
  diff: ScanDiff;
  before: ComparableScan;
  after: ComparableScan;
}) {
  const sameScan = before.id === after.id;

  return (
    <div className="animate-fade-up space-y-6" data-testid="what-changed">
      {/* Headline — the two scans being compared + at-a-glance counts. */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent">What changed</div>
            <p className="mt-1 text-sm text-slate-400">
              <span className="text-slate-300">{scanCaption(before)}</span>
              <span aria-hidden className="mx-2 text-slate-600">→</span>
              <span className="text-slate-300">{scanCaption(after)}</span>
            </p>
          </div>
          <DeltaPill delta={diff.overall.delta} suffix="overall" />
        </div>

        {sameScan ? (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-400">
            Same scan selected on both sides — pick two different scans to see a diff.
          </p>
        ) : diff.unchanged ? (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-400">
            No measurable change between these two scans — same level, posture, scores, and open gaps.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {diff.appearedSignalCount > 0 && (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-300">
                {diff.appearedSignalCount} {diff.appearedSignalCount === 1 ? "signal" : "signals"} detected
              </span>
            )}
            {diff.disappearedSignalCount > 0 && (
              <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 font-semibold text-red-300">
                {diff.disappearedSignalCount} {diff.disappearedSignalCount === 1 ? "signal" : "signals"} lost
              </span>
            )}
            {diff.closedGapCount > 0 && (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-300">
                {diff.closedGapCount} {diff.closedGapCount === 1 ? "gap" : "gaps"} closed
              </span>
            )}
            {diff.openedGapCount > 0 && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-semibold text-amber-300">
                {diff.openedGapCount} {diff.openedGapCount === 1 ? "gap" : "gaps"} opened
              </span>
            )}
            {diff.recsMovedToDone.length > 0 && (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-semibold text-accent">
                {diff.recsMovedToDone.length} {diff.recsMovedToDone.length === 1 ? "recommendation" : "recommendations"} done
              </span>
            )}
          </div>
        )}
      </div>

      {/* Explained movement — each score change tied to the concrete evidence behind it. */}
      {diff.movements.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-lg font-semibold text-white">Why it moved</h2>
          <p className="mt-1 text-sm text-slate-400">
            Each dimension&apos;s score change attributed to the specific signals that drove it.
          </p>
          <ul className="mt-3 space-y-2">
            {diff.movements.map((m, i) => (
              <li
                key={i}
                className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 font-mono text-[13px] leading-relaxed text-slate-300"
              >
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Level + posture transitions. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Transition
          label="Maturity level"
          changed={diff.level.changed}
          before={<LevelChip id={diff.level.before.id} name={diff.level.before.name} />}
          after={<LevelChip id={diff.level.after.id} name={diff.level.after.name} />}
        />
        <Transition
          label="Posture"
          changed={diff.posture.changed}
          before={
            <span className="rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-300">
              {diff.posture.before.label}
            </span>
          }
          after={
            <span className="rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs text-slate-300">
              {diff.posture.after.label}
            </span>
          }
        />
      </div>

      {/* Axis roll-ups (Adoption × Rigor). */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AxisDeltaRow label="AI Adoption" axis={diff.adoption} />
        <AxisDeltaRow label="Engineering Rigor" axis={diff.rigor} />
      </div>

      {/* Per-dimension diff — the full dimension list, GitHub-style annotated. */}
      <div>
        <h2 className="text-lg font-semibold text-white">By dimension</h2>
        <p className="mt-1 text-sm text-slate-400">
          Each dimension&apos;s score change, with the gaps that closed or opened between scans.
        </p>
        <div className="mt-4 space-y-3">
          {diff.dimensions.map((d) => (
            <DimensionDiffCard key={d.id} d={d} />
          ))}
        </div>
      </div>

      {/* Recommendations that moved to done. */}
      {diff.recsMovedToDone.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-lg font-semibold text-white">Recommendations completed</h2>
          <p className="mt-1 text-sm text-slate-400">
            Tracked items marked done between these two scans.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {diff.recsMovedToDone.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-slate-300">
                <span aria-hidden className="text-emerald-400">✓</span>
                <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                  {DIMENSION_SHORT[r.dimId]}
                </span>
                <span className="line-through decoration-slate-600">{r.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AxisDeltaRow({ label, axis }: { label: string; axis: ScanDiff["adoption"] }) {
  const color = scoreHex(axis.after);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">{label}</span>
        <div className="flex items-center gap-2 font-mono text-sm tabular-nums">
          <span className="text-slate-400">{axis.before}</span>
          <span aria-hidden className="text-slate-600">→</span>
          <span className="font-bold" style={{ color }}>{axis.after}</span>
          <DeltaTag delta={axis.delta} />
        </div>
      </div>
      <DiffBar before={axis.before} after={axis.after} />
    </div>
  );
}
