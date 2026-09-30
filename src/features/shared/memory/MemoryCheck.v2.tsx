"use client";

// The duplicate check stays advisory. Radios keep name="supersede" and the same aria-labels.
// There is no kit radio: each choice is a native radio, and the match is a cell mark, not a hue.
import { Caption, CellMark, GhostAction } from "@/components/kit";
import type { CellState } from "@/components/kit";
import { RELATION_LABEL, recommendationCopy, type CheckResponse } from "./memoryCheck";
import { memoryKindLabel } from "@/lib/org/memory-kinds";
import { excerpt } from "./memoryView";

function verdictState(recommendation: CheckResponse["recommendation"]): CellState {
  return recommendation === "duplicate" || recommendation === "supersede" ? "partial" : "met";
}

export function MemoryCheckV2({
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
  return (
    <fieldset className="mt-3 border-t border-divider pt-3">
      <legend className="type-body-sm font-medium text-white">
        <CellMark state={verdictState(recommendation)}>{recommendationCopy(recommendation, duplicates.length)}</CellMark>
      </legend>
      <Caption className="mt-1">
        Compared {comparedCount} memor{comparedCount === 1 ? "y" : "ies"}.{" "}
        {llmUnavailable ? "Word-overlap estimate, no model." : `Judged by ${engine}.`}
      </Caption>
      {summary && (
        <p className="mt-2 type-body-sm text-slate-200">
          <span className="text-slate-400">Suggested phrasing: </span>
          {summary}
        </p>
      )}
      {duplicates.length > 0 && (
        <div className="mt-3">
          {duplicates.map((d) => {
            const selected = supersedeId === d.id;
            return (
              <label key={d.id} className="flex cursor-pointer gap-3 border-t border-divider py-3">
                <input
                  type="radio"
                  name="supersede"
                  checked={selected}
                  onChange={() => setSupersedeId(d.id)}
                  className="mt-1 shrink-0"
                  aria-label={`Supersede the memory: ${d.memory.content.slice(0, 60)}`}
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <CellMark state={llmUnavailable ? "partial" : "met"}>{RELATION_LABEL[d.relation]}</CellMark>
                    <span className="type-body-sm text-slate-400" title="Similarity to the proposed memory">
                      {Math.round(d.similarity * 100)}% match
                    </span>
                    <span className="type-caption text-slate-400">
                      {memoryKindLabel(d.memory.kind)}
                      {d.memory.createdBy ? `, ${d.memory.createdBy}` : ""}
                    </span>
                  </span>
                  <span className={`mt-1 block type-body-sm ${selected ? "text-slate-400 line-through" : "text-slate-200"}`}>
                    {excerpt(d.memory.content)}
                  </span>
                  {d.reason && <span className="mt-0.5 block type-caption text-slate-400">{d.reason}</span>}
                </span>
              </label>
            );
          })}
          <label className="flex cursor-pointer items-center gap-3 border-t border-divider py-3">
            <input type="radio" name="supersede" checked={supersedeId === null} onChange={() => setSupersedeId(null)} />
            <span className="type-body-sm text-slate-200">
              Keep both <span className="text-slate-400">(store this as a new, independent memory)</span>
            </span>
          </label>
          {supersedeId && <Caption>Superseded on save. History is kept.</Caption>}
        </div>
      )}
      <div className="mt-2">
        <GhostAction onClick={onDismiss}>Dismiss</GhostAction>
      </div>
    </fieldset>
  );
}
