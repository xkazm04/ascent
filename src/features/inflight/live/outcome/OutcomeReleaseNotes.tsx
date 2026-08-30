"use client";

// VARIANT — "Release notes". The outcome as a CHANGELOG the director can forward: newest run first,
// one dated entry per run, the entry's title IS the lift sentence, and under it each repo's deliverables
// as short lines. Reference: Linear's changelog — one column, a date eyebrow, one large title, bullet
// lines under bold sub-labels, generous rhythm, nothing that looks like a table. Persuading, not
// monitoring: no deltas per dimension, no commit counts, no evidence prose — those live in Storyboard.
//
// The newest entry is open by default; older entries are one dateline each until clicked. Opening an
// entry also replays that run on the field (onOpen), so reading and watching stay one gesture.

import { useState } from "react";
import { ReleaseNotesEntry } from "./OutcomeReleaseNotesEntry";
import type { OutcomeVariantProps } from "./OutcomeStoryboard";
import { runCells } from "./outcomeEntries";

export function OutcomeReleaseNotes({ matrix, selectedId, onOpen }: OutcomeVariantProps) {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const isOpen = (id: string) => overrides.get(id) ?? id === matrix.latestId;
  if (matrix.columns.length === 0) {
    return (
      <p className="type-body py-10 text-center text-slate-400">
        No runs yet. Pick repos in the sky and start one — each run lands here, dated.
      </p>
    );
  }
  const newestFirst = [...matrix.columns].reverse();
  return (
    <ol className="divide-y divide-divider">
      {newestFirst.map((col, i) => (
        <ReleaseNotesEntry
          key={col.id}
          col={col}
          index={matrix.columns.length - i}
          cells={runCells(matrix, col.id)}
          latest={col.id === matrix.latestId}
          selected={col.id === selectedId}
          open={isOpen(col.id)}
          onToggle={() => {
            setOverrides((prev) => new Map(prev).set(col.id, !isOpen(col.id)));
            onOpen(col.id);
          }}
        />
      ))}
    </ol>
  );
}
