"use client";

// Packed and omitted rows share one shape. The score is the server's. A filtered row was never
// scored, so it is not measured. Pressing a row opens the full text and the three ranking factors.
import { useState } from "react";
import { Caption, CellMark, HairlineList, Ladder, ListRow, Panel } from "@/components/kit";
import type { CellState } from "@/components/kit";
import { memoryKindLabel } from "@/lib/org/memory-kinds";
import { INELIGIBLE_COPY, type IneligibleMemoryRow, type ScoredMemoryRow } from "./memoryRecall";
import { recallFactors } from "./RecallContribution";

import { ageLabel, excerpt, factorState, ineligibleCell } from "./memoryView";

function markFor(state: string): CellState {
  if (state === "not-judged") return "unmeasured";
  if (state === "measured") return "partial";
  return "missing";
}

function meta(item: ScoredMemoryRow): string {
  return `${memoryKindLabel(item.kind)}, ${item.namespace || "org-wide"}, ${ageLabel(item.ageDays)} old, conf ${item.confidence.toFixed(2)}, ${item.accessCount} recall${item.accessCount === 1 ? "" : "s"}, ${item.content.length} chars`;
}

export function ScoredRowsV2({ items, mark, word }: { items: ScoredMemoryRow[]; mark: CellState; word: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const current = items.find((m) => m.id === open) ?? null;
  return (
    <div>
      <HairlineList>
        {items.map((m) => (
          <ListRow
            key={m.id}
            onPress={() => setOpen(open === m.id ? null : m.id)}
            selected={open === m.id}
            title={excerpt(m.content, 180)}
            detail={
              <>
                <CellMark state={mark}>{word}</CellMark> {meta(m)}
              </>
            }
            trailing={<span className="type-body-sm tabular-nums text-slate-200">{m.score.toFixed(3)}</span>}
          />
        ))}
      </HairlineList>
      {current && <FactorScene item={current} />}
    </div>
  );
}

function FactorScene({ item }: { item: ScoredMemoryRow }) {
  const factors = recallFactors(item);
  return (
    <Panel pad="sm" className="mt-3" aria-label="Recall factors">
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap type-body-sm text-slate-200">{item.content}</pre>
      <div className="mt-3">
        <Ladder
          label="Ranking factors"
          steps={factors.map((f) => ({
            key: f.id,
            label: f.label.charAt(0).toUpperCase() + f.label.slice(1),
            state: factorState(f.value),
            detail:
              f.id === "delivery" && item.accessCount === 0
                ? "never delivered, a counted zero, not a missing measurement"
                : f.detail,
          }))}
        />
      </div>
      <Caption className="mt-2">Score {item.score.toFixed(3)}, from the server. The factors are not multiplied back into it.</Caption>
    </Panel>
  );
}

export function IneligibleRowsV2({ items }: { items: IneligibleMemoryRow[] }) {
  return (
    <HairlineList>
      {items.map((m) => (
        <ListRow
          key={m.id}
          title={excerpt(m.content, 180)}
          detail={
            <>
              <CellMark state={ineligibleCell(m.reason)}>{INELIGIBLE_COPY[m.reason]}</CellMark>{" "}
              {memoryKindLabel(m.kind)}
              {m.namespace ? `, ${m.namespace}` : ""}
            </>
          }
        />
      ))}
    </HairlineList>
  );
}

export function OmissionBlock({
  title,
  hint,
  state,
  count,
  children,
}: {
  title: string;
  hint: string;
  state: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="mt-4 border-t border-divider pt-3">
      <summary className="cursor-pointer type-body-sm text-slate-400">
        <CellMark state={markFor(state)}>
          {count} {title}
        </CellMark>
      </summary>
      <Caption className="mt-2">{hint}</Caption>
      <div className="mt-2">{children}</div>
    </details>
  );
}

