"use client";

// The saved-plan bar: the visible surface of a durable Roadmap Sandbox scenario.
//
// Extracted from RoadmapSandboxScenario.tsx (which owns the IO + restore hooks) purely to keep both
// files comfortably under the 300-LOC ceiling — this is relocation, not a redesign.

import type { SandboxScenarioRecord } from "@/lib/db/sandbox-scenario";
import type { ScenarioSaveState } from "@/components/report/RoadmapSandboxScenario";
import { Kicker } from "@/components/ui";
import { DeltaTag } from "@/components/report/deltas";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Projected-vs-actual, shown only once a scan NEWER than the modeled one has landed. Both numbers are
 * deltas over the SAME stored baseline, which is what makes them comparable at all — and why the
 * projection is a column rather than a number parsed back out of a note.
 */
function ScenarioOutcome({ scenario }: { scenario: SandboxScenarioRecord }) {
  const { projected, actual } = scenario;
  if (!actual) return null;
  const gap = actual.delta - projected.delta;
  const behind = Math.abs(gap);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-400">
      <span className="text-slate-300">Since you modeled this:</span>
      <span className="inline-flex items-center gap-1">
        projected <DeltaTag delta={projected.delta} />
      </span>
      <span aria-hidden className="text-slate-600">
        ·
      </span>
      <span className="inline-flex items-center gap-1">
        actual <DeltaTag delta={actual.delta} />
      </span>
      <span className="text-slate-500">
        {gap === 0
          ? `— exactly as modeled (scanned ${dateLabel(actual.scannedAt)}).`
          : gap > 0
            ? `— ${gap} pt${gap === 1 ? "" : "s"} ahead of the model (scanned ${dateLabel(actual.scannedAt)}).`
            : `— ${behind} pt${behind === 1 ? "" : "s"} short so far (scanned ${dateLabel(actual.scannedAt)}).`}
      </span>
    </p>
  );
}

export function ScenarioBar({
  scenario,
  state,
  restored,
  anyChanged,
  onSave,
  onDiscard,
}: {
  scenario: SandboxScenarioRecord | null;
  state: ScenarioSaveState;
  /** True while the live sliders still equal the saved scenario's — the "plan is loaded" notice. */
  restored: boolean;
  /** Whether the sliders currently differ from the report — nothing to save otherwise. */
  anyChanged: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (state === "unavailable") return null;

  const disabledTitle = !anyChanged
    ? "Move a slider (or try a recommendation) first — there's no model to save yet."
    : undefined;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-divider bg-slate-950/30 p-4">
      <div className="min-w-0">
        <Kicker tone="accent">Saved plan</Kicker>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-slate-400">
          {scenario
            ? `Saved ${dateLabel(scenario.updatedAt)} against the ${dateLabel(scenario.baseline.scannedAt)} scan — sliders, the gaps you picked, and the projected score.`
            : "Keep this what-if: the slider positions, the gaps you picked, and the projected score — restored next time you open the sandbox."}
        </p>
        <div role="status" aria-live="polite">
          {restored && state !== "saving" && state !== "saved" && (
            <p className="mt-1 text-sm text-emerald-300">Your saved plan is loaded — drag to keep exploring.</p>
          )}
          {state === "saved" && <p className="mt-1 text-sm text-emerald-300">Plan saved.</p>}
          {state === "error" && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-amber-200/90">
              <span aria-hidden>ⓘ</span>
              Couldn&apos;t save the plan just now — try again.
            </p>
          )}
        </div>
        {scenario && <ScenarioOutcome scenario={scenario} />}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {scenario && (
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white"
          >
            Discard
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={!anyChanged || state === "saving"}
          title={disabledTitle}
          className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === "saving" ? "Saving…" : scenario ? "Update saved plan" : "Save this plan"}
        </button>
      </div>
    </div>
  );
}
