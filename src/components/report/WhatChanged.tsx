// The "What changed" panel — renders a ScanDiff (see lib/report/compare.ts) as a story of
// progress between two scans: overall/axis deltas, level & posture transitions, GitHub-style
// red/green dimension cards, gaps that closed vs opened, and recommendations that moved to
// done. Pure presentational (no hooks) so it renders on the server alongside the live picker.

import type { ComparableScan } from "@/lib/db/scans";
import type { ScanDiff } from "@/lib/report/compare";
import { DIMENSION_SHORT } from "@/lib/ui";
import { DeltaPill } from "@/components/report/deltas";
import {
  AxisDeltaRow,
  DimensionDiffCard,
  LevelChip,
  Transition,
  scanCaption,
} from "@/components/report/WhatChangedParts";

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
            <div className="font-mono text-sm uppercase tracking-[0.25em] text-accent">What changed</div>
            <p className="mt-1 text-base text-slate-400">
              <span className="text-slate-300">{scanCaption(before)}</span>
              <span aria-hidden className="mx-2 text-slate-600">→</span>
              <span className="text-slate-300">{scanCaption(after)}</span>
            </p>
          </div>
          <DeltaPill delta={diff.overall.delta} suffix="overall" />
        </div>

        {sameScan ? (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 text-base text-slate-400">
            Same scan selected on both sides — pick two different scans to see a diff.
          </p>
        ) : diff.unchanged ? (
          <p className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 text-base text-slate-400">
            No measurable change between these two scans — same level, posture, scores, and open gaps.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
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
          <p className="mt-1 text-base text-slate-400">
            Each dimension&apos;s score change attributed to the specific signals that drove it.
          </p>
          <ul className="mt-3 space-y-2">
            {diff.movements.map((m, i) => (
              <li
                key={i}
                className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 font-mono text-sm leading-relaxed text-slate-300"
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
            <span className="rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-sm text-slate-300">
              {diff.posture.before.label}
            </span>
          }
          after={
            <span className="rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-sm text-slate-300">
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
        <p className="mt-1 text-base text-slate-400">
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
          <p className="mt-1 text-base text-slate-400">
            Tracked items marked done between these two scans.
          </p>
          <ul className="mt-3 space-y-2 text-base">
            {diff.recsMovedToDone.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-slate-300">
                <span aria-hidden className="text-emerald-400">✓</span>
                <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-400">
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
