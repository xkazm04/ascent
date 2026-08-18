"use client";

// The write-intelligence verdict (design doc §8): what the duplicate/consolidation pass found, and the
// author's choice of what to do about it. Rendered by MemoryPanel.AuthorForm after a "Check" run.
//
// It is ADVISORY, never a wall: "Keep both" is always available and pre-selected unless the pass
// recommends superseding. The author is the last word — an LLM that times out, or a heuristic that
// over-matches, must not be able to stop a memory from being written.

import { RELATION_LABEL, recommendationCopy, type CheckResponse } from "@/features/shared/memory/memoryCheck";
import { memoryKindLabel } from "@/lib/org/memory-kinds";

const EXCERPT = 220;

export function CheckVerdict({
  verdict,
  supersedeId,
  setSupersedeId,
  onDismiss,
}: {
  verdict: CheckResponse;
  supersedeId: string | null;
  setSupersedeId: (id: string | null) => void;
  onDismiss: () => void;
}) {
  const { recommendation, duplicates, summary, llmUnavailable, engine, comparedCount } = verdict;
  const tone =
    recommendation === "duplicate"
      ? "border-orange-500/40 bg-orange-500/5"
      : recommendation === "supersede"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-slate-700 bg-slate-950/40";

  return (
    <div className={`mt-3 rounded-xl border p-3 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200">
            {recommendationCopy(recommendation, duplicates.length)}
          </p>
          <p className="mt-0.5 font-mono text-xs text-slate-500">
            {/* Never imply we scanned the whole store — say exactly what was compared, and by what. */}
            compared {comparedCount} memor{comparedCount === 1 ? "y" : "ies"} ·{" "}
            {llmUnavailable ? (
              <span title="No model engine was reachable: this is a deterministic word-overlap estimate, not a semantic judgment.">
                word-overlap estimate (no model)
              </span>
            ) : (
              <span title="Judged semantically by the configured model provider.">judged by {engine}</span>
            )}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 font-mono text-xs text-slate-600 hover:text-slate-300"
          title="Dismiss this check"
        >
          dismiss
        </button>
      </div>

      {summary && (
        <p className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-sm text-slate-300">
          <span className="font-mono text-xs text-slate-500">suggested phrasing · </span>
          {summary}
        </p>
      )}

      {duplicates.length > 0 && (
        <>
          <div className="mt-3 space-y-2">
            {duplicates.map((d) => {
              const selected = supersedeId === d.id;
              return (
                <label
                  key={d.id}
                  className={`flex cursor-pointer gap-2.5 rounded-lg border p-2.5 transition ${
                    selected ? "border-accent/60 bg-accent/5" : "border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="supersede"
                    checked={selected}
                    onChange={() => setSupersedeId(d.id)}
                    className="mt-1 shrink-0"
                    aria-label={`Supersede the memory: ${d.memory.content.slice(0, 60)}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs text-slate-400">
                        {RELATION_LABEL[d.relation]}
                      </span>
                      <span className="font-mono text-xs text-slate-500" title="Similarity to the proposed memory">
                        {Math.round(d.similarity * 100)}% match
                      </span>
                      <span className="font-mono text-xs text-slate-600">
                        {memoryKindLabel(d.memory.kind)}
                        {d.memory.createdBy ? ` · ${d.memory.createdBy}` : ""}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm text-slate-300">
                      {d.memory.content.slice(0, EXCERPT)}
                      {d.memory.content.length > EXCERPT && "…"}
                    </span>
                    {d.reason && <span className="mt-0.5 block text-xs text-slate-500">{d.reason}</span>}
                  </span>
                </label>
              );
            })}
          </div>

          <label
            className={`mt-2 flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 transition ${
              supersedeId === null ? "border-accent/60 bg-accent/5" : "border-slate-800 hover:border-slate-700"
            }`}
          >
            <input
              type="radio"
              name="supersede"
              checked={supersedeId === null}
              onChange={() => setSupersedeId(null)}
              className="shrink-0"
            />
            <span className="text-sm text-slate-300">
              Keep both
              <span className="ml-1.5 font-mono text-xs text-slate-600">
                (store this as a new, independent memory)
              </span>
            </span>
          </label>

          {supersedeId && (
            <p className="mt-2 font-mono text-xs text-amber-300/80">
              On save, the selected memory is marked superseded and leaves the default list. Its history
              is kept.
            </p>
          )}
        </>
      )}
    </div>
  );
}
