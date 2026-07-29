"use client";

// THE RECALL SURFACE — what makes *recall* different from *browse*.
//
// The list above this panel is sorted by date: it answers "what was written recently". Recall answers
// the question people actually have — "what does this org already know about our CI story, in the
// 6000 characters I can afford to paste into an agent?" — by scoring every eligible memory on trust ×
// exponential per-kind decay × proven usefulness, then packing whole items greedily into the budget.
//
// That core (src/lib/memory/recall.ts) was deterministic, tested, and called by NOTHING in the product.
// This panel is pure surfacing: it changes no half-life, no budget default, and no packing rule.
//
// TWO THINGS IT REFUSES TO DO:
//  1. Show only the winners. Every omission is listed with the REASON — budget-bound (raise the budget)
//     versus not recallable (superseded/archived/expired; no budget fixes those). A ranking you cannot
//     see the losers of is not auditable.
//  2. Recompute score/ageDays in the browser. They are rendered verbatim from the response, so the
//     number shown is the number that ranked the row.
//
// Reads are UNGATED (any org member), matching the route.

import { useEffect, useRef, useState } from "react";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { IneligibleRow, OmissionGroup, ScoredRow } from "@/components/org/library/memory/MemoryRecallRows";
import { runRecall, type RecallResponse } from "@/components/org/library/memory/memoryRecall";
import { memoryKindLabel } from "@/lib/org/memory-kinds";

const DEFAULT_BUDGET = 6000;
const MIN_BUDGET = 200;
const MAX_BUDGET = 60_000;

const selectClass =
  "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200";

export function MemoryRecallPanel({
  slug,
  namespaces,
  kinds,
}: {
  slug: string;
  namespaces: string[];
  kinds: readonly string[];
}) {
  const [charBudget, setCharBudget] = useState(DEFAULT_BUDGET);
  const [namespace, setNamespace] = useState("");
  const [kind, setKind] = useState("");
  const [result, setResult] = useState<RecallResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function recall() {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    setError(null);
    try {
      setResult(
        await runRecall(
          {
            org: slug,
            namespace: namespace || undefined,
            kinds: kind ? [kind] : undefined,
            charBudget,
          },
          ac.signal,
        ),
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : "Recall failed.");
      }
    } finally {
      if (abort.current === ac) abort.current = null;
      setRunning(false);
    }
  }

  const fill = result ? Math.min(100, Math.round((result.usedChars / result.charBudget) * 100)) : 0;

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Recall — what an agent would be handed"
        description="Ask for the org's most valuable knowledge within a character budget. Ranking is confidence × per-kind decay × proven usefulness, and items are packed whole — never truncated mid-memory. Everything that did not make it is listed below with the reason. Packed memories have their recall count incremented, because they reached a reader."
      />

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-xs uppercase tracking-widest text-slate-500">budget (chars)</span>
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
          <span className="font-mono text-xs uppercase tracking-widest text-slate-500">namespace</span>
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
          <span className="font-mono text-xs uppercase tracking-widest text-slate-500">kind</span>
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
          onClick={recall}
          disabled={running}
          className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {running ? "Recalling…" : "Recall"}
        </button>
      </div>

      {result && (
        <div className="mt-4">
          <p className="font-mono text-xs tabular-nums text-slate-500">
            packed {result.memories.length} of {result.consideredCount} eligible · {result.usedChars}/
            {result.charBudget} chars ({fill}%)
          </p>
          <div className="mt-1 h-1 w-full overflow-hidden rounded bg-divider">
            <div className="h-full bg-accent" style={{ width: `${fill}%` }} />
          </div>

          {result.memories.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              Nothing was packed. {result.omittedCount > 0
                ? "Everything eligible was larger than the budget — raise it below."
                : "There is no recallable memory in this scope yet."}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-divider">
              {result.memories.map((m) => (
                <ScoredRow key={m.id} item={m} />
              ))}
            </ul>
          )}

          <OmissionGroup
            title="ranked but left out — budget"
            hint="These are recallable and were scored; they simply did not fit. Packing is whole-item and greedy, so an oversized memory is skipped rather than ending the pass — a smaller, lower-ranked one can still land. Raise the budget to admit them."
            count={result.omitted.length}
          >
            {result.omitted.map((m) => (
              <ScoredRow key={m.id} item={m} muted />
            ))}
          </OmissionGroup>

          <OmissionGroup
            title="not recallable"
            hint="These exist in the store but can never reach an agent's context, whatever the budget."
            count={result.ineligible.length}
          >
            {result.ineligible.map((m) => (
              <IneligibleRow key={m.id} item={m} />
            ))}
          </OmissionGroup>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}
    </Card>
  );
}
