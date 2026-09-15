"use client";

// The recall query row — budget, namespace, kind, run. Extracted from MemoryRecallPanel so the panel
// stays an orchestrator under the 200-LOC features cap, and so the panel's FIRST element under its
// header can be the BudgetPack graphic rather than a form.

import { memoryKindLabel } from "@/lib/org/memory-kinds";
import { PACKED_HINT } from "@/features/shared/memory/recallOmissions";

export const DEFAULT_BUDGET = 6000;
const MIN_BUDGET = 200;
const MAX_BUDGET = 60_000;

const selectClass =
  "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 type-mono-sm text-slate-200";

export function MemoryRecallControls({
  charBudget,
  setCharBudget,
  namespace,
  setNamespace,
  kind,
  setKind,
  namespaces,
  kinds,
  running,
  onRecall,
}: {
  charBudget: number;
  setCharBudget: (v: number) => void;
  namespace: string;
  setNamespace: (v: string) => void;
  kind: string;
  setKind: (v: string) => void;
  namespaces: string[];
  kinds: readonly string[];
  running: boolean;
  onRecall: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="type-label tracking-widest text-slate-500">budget (chars)</span>
        <input
          type="number"
          min={MIN_BUDGET}
          max={MAX_BUDGET}
          step={500}
          value={charBudget}
          onChange={(e) => setCharBudget(Number(e.target.value))}
          className={`${selectClass} w-32 tabular-nums`}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="type-label tracking-widest text-slate-500">namespace</span>
        <select value={namespace} onChange={(e) => setNamespace(e.target.value)} className={selectClass}>
          <option value="">all</option>
          {namespaces.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="type-label tracking-widest text-slate-500">kind</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={selectClass}>
          <option value="">all</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {memoryKindLabel(k)}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={onRecall}
        disabled={running}
        title={PACKED_HINT}
        className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 type-body-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
      >
        {running ? "Recalling…" : "Recall"}
      </button>
    </div>
  );
}
