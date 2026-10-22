"use client";

import { type ScopePlan, scopeDrawNote, scopeLabel } from "./fleetScopeModel";

/** "Scan what you filtered": the triage match set as one previewed, single-pending action, rendered in
 *  TriageControls' action slot beside the match count. The label says how many matching WATCHED repos
 *  it will scan and how many unwatched matches it will not; the note says what it draws, before the
 *  click. While it runs, the one control is a Cancel that stops before the next org. */
export function ScopeScan({
  plan,
  active,
  cancelling,
  onRun,
  onCancel,
}: {
  plan: ScopePlan | null;
  active: boolean;
  cancelling: boolean;
  onRun: () => void;
  onCancel: () => void;
}) {
  if (active) {
    return (
      <span className="flex items-center gap-2 type-mono-sm text-slate-400">
        <span role="status" aria-live="polite">
          {cancelling ? "Stopping after this org…" : "Scanning matches, one org at a time…"}
        </span>
        {!cancelling && (
          <button type="button" onClick={onCancel} className="text-slate-500 underline-offset-2 hover:text-white hover:underline">
            Stop after this org
          </button>
        )}
      </span>
    );
  }
  if (!plan) return null;

  const label = scopeLabel(plan);
  const note = scopeDrawNote(plan);
  const disabled = plan.runs.length === 0;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {/* aria-disabled, not disabled: the reason stays reachable by keyboard and in the title. The
          click is guarded, so a disabled plan never POSTs an empty scope (the server would widen it
          to the whole watchlist). */}
      <button
        type="button"
        onClick={() => {
          if (!disabled) onRun();
        }}
        aria-disabled={disabled || undefined}
        title={note}
        className="rounded-md border border-accent/50 bg-accent/10 px-2 py-0.5 type-mono-sm font-medium text-white transition hover:bg-accent/20 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-accent/10"
      >
        {label}
      </button>
      <span className="type-mono-sm text-slate-500">{note}</span>
    </span>
  );
}
