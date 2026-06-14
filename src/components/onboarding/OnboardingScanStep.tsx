"use client";

import { OnboardingChecklist, type ChecklistStep } from "@/components/onboarding/OnboardingChecklist";
import { ScanRowView, type ScanRow } from "@/components/onboarding/OnboardingScanRow";
import { LEVELS } from "@/lib/maturity/model";
import { LEVEL_CLASSES, LEVEL_GLYPH } from "@/lib/ui";
import type { LevelId } from "@/lib/types";

// One-line, plain-language read of each maturity level for the onboarding legend (ONB-4) — the
// scores otherwise land with no interpretation. Keyed by level id; names come from the rubric.
const LEVEL_BLURB: Record<LevelId, string> = {
  L1: "Manual — AI used ad hoc, little shared tooling or guardrails.",
  L2: "Assisted — AI tooling adopted, basic tests/CI starting to form.",
  L3: "Augmented — shared AI guidance, CI gates, and tests are the norm.",
  L4: "Integrated — AI is in the loop with strong process + quality enforcement.",
  L5: "Autonomous — repeatable AI harness, evals, and trustworthy automation.",
};

/** The scanning + done phases: live region, progress bar, streamed rows, and (on done) the
 *  activation checklist + dashboard CTAs. */
export function ScanStep({
  phase,
  rows,
  error,
  announce,
  preview = false,
  checklistSteps,
  onCancel,
  onViewDashboard,
  onScanAnother,
}: {
  phase: "scanning" | "done";
  rows: Record<string, ScanRow>;
  error: string | null;
  announce: string;
  /** The scan was a deterministic PREVIEW (mock), not a real LLM scan — disclosed so the numbers
   *  aren't mistaken for live scores. */
  preview?: boolean;
  checklistSteps: ChecklistStep[];
  onCancel: () => void;
  onViewDashboard: () => void;
  onScanAnother: () => void;
}) {
  const completed = Object.values(rows).filter((r) => r.level || r.error).length;
  const errorCount = Object.values(rows).filter((r) => r.error).length;
  const scanTotal = Object.keys(rows).length;
  const pct = scanTotal ? Math.round((completed / scanTotal) * 100) : 0;

  return (
    <div key={phase} className="animate-phase-in">
      {/* Polite live region — announces scan progress + completion for screen readers. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>

      <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
        {phase === "done" && (
          <span
            aria-hidden
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-base ${
              errorCount > 0
                ? "border-orange-500/50 bg-orange-500/15 text-orange-300"
                : "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
            }`}
          >
            {errorCount > 0 ? "!" : "✓"}
          </span>
        )}
        {phase === "done" ? "Scan complete" : "Scanning repositories"}
      </h1>
      <p className="mt-1 text-slate-400">
        {phase === "done"
          ? errorCount > 0
            ? `Here's how your repositories scored — ${errorCount} couldn't be scanned.`
            : "Here's how your repositories scored."
          : `Scanning ${scanTotal} repositories…`}
      </p>

      {/* Progress bar (accessible) — eased width, role=progressbar. */}
      <div className="mt-4 flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Scan progress: ${completed} of ${scanTotal} repositories`}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-500 transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-mono text-sm tabular-nums text-slate-400">
          {pct}% · {completed}/{scanTotal}
        </span>
        {phase === "scanning" && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-danger/50 hover:text-danger-soft"
          >
            Cancel
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-base text-danger-soft">
          {error}
        </p>
      )}

      <div className="mt-5 space-y-1.5">
        {Object.values(rows).map((row) => (
          <ScanRowView key={row.repo} row={row} />
        ))}
      </div>

      {phase === "done" && preview && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-300">
          These are <strong>preview</strong> scores — a fast, illustrative estimate. For live numbers,
          install the GitHub App and run a real scan (it draws prepaid credits) from the dashboard.
        </p>
      )}

      {phase === "done" && (
        <>
          {/* ONB-4: a compact "what your score means" legend, so the scores land with meaning. */}
          <details className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <summary className="cursor-pointer font-mono text-sm uppercase tracking-widest text-slate-400 hover:text-white">
              How maturity levels work
            </summary>
            <ul className="mt-2 space-y-1.5">
              {LEVELS.map((l) => (
                <li key={l.id} className="flex items-start gap-2 text-sm text-slate-300">
                  <span aria-hidden className={`mt-0.5 ${LEVEL_CLASSES[l.id as LevelId]?.text ?? "text-slate-400"}`}>
                    {LEVEL_GLYPH[l.id as LevelId]} {l.id}
                  </span>
                  <span>{LEVEL_BLURB[l.id as LevelId] ?? l.name}</span>
                </li>
              ))}
            </ul>
          </details>

          <div className="mt-6">
            <OnboardingChecklist steps={checklistSteps} />
          </div>
          <div className="mt-6 flex gap-3">
            <button
              onClick={onViewDashboard}
              className="rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
            >
              View dashboard
            </button>
            <button
              onClick={onScanAnother}
              className="rounded-lg border border-slate-700 px-4 py-2.5 text-base text-slate-300 hover:border-slate-600"
            >
              Scan another
            </button>
          </div>
        </>
      )}
    </div>
  );
}
