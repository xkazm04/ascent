"use client";

// Owner control for GatePolicy.minAiGovernedRate — the provenance bar: minimum share of
// AI-attributed merged PRs that carried an approving human review. Kept in its own file so
// GatePolicyEditor.tsx stays inside the 200-LOC cap (AGENTS.md). Unchecking omits the field
// (sanitizeGatePolicy treats ≤0 as "not set"); the form owns this bar, so it is listed in
// EDITED_POLICY_FIELDS and is not carried in passthrough.

export function AiGovernedRateRow({
  enabled,
  rate,
  onEnabled,
  onRate,
}: {
  enabled: boolean;
  rate: string;
  onEnabled: (v: boolean) => void;
  onRate: (v: string) => void;
}) {
  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="type-mono-sm uppercase tracking-widest text-slate-500">AI-governed review</span>
        <span className="type-body-sm text-slate-500">
          Share of AI-attributed merged PRs that carried an approving human review.
        </span>
      </div>
      <label className="mt-2 flex items-center justify-between gap-2 type-body-sm text-slate-400">
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabled(e.target.checked)}
            className="accent-accent"
          />
          Min AI-governed rate (%)
        </span>
        <input
          type="number"
          aria-label="Minimum AI-governed rate"
          min={1}
          max={100}
          value={rate}
          disabled={!enabled}
          onChange={(e) => onRate(e.target.value)}
          className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 type-body-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
        />
      </label>
    </div>
  );
}
