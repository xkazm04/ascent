"use client";

// One practice in the Prism library. The row opens the level. Stages are CellMarks: glyph, word,
// and a paper score when the cell has one. ListRow cannot carry an id, so the anchor sits on the title.
import { CellMark, ListRow, Movement } from "@/components/kit";
import { ROLLOUT_AXES } from "./practiceRolloutViz";
import type { RolloutEntry } from "./practiceRolloutGroups";
import type { PracticeRow } from "./practiceRows";
import { stageMark } from "./stageMark";

function Motion({ row }: { row: PracticeRow }) {
  const rollout = row.rollout;
  if (!rollout || (rollout.open === 0 && rollout.merged === 0)) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 text-slate-400" data-motion>
      {rollout.open > 0 && <span>{rollout.open} in flight</span>}
      {rollout.merged > 0 && <span>{rollout.merged} landed</span>}
      {rollout.merged > 0 && rollout.lift == null && <span>awaiting rescan</span>}
      {rollout.lift != null && rollout.lift !== 0 && <Movement delta={rollout.lift} basis="avg" toneClass={() => "text-slate-200"} />}
      {rollout.lift === 0 && <span className="text-slate-200">0 avg</span>}
    </span>
  );
}

export function PracticeRowV2({ entry, onOpen }: { entry: RolloutEntry; onOpen: (row: PracticeRow) => void }) {
  const { row, cells } = entry;
  const assessed = row.source === "mined" && (row.mined?.total ?? 0) === 0;
  const anchor = row.source === "mined" ? `practice-${row.id}` : undefined;
  return (
    <ListRow
      onPress={() => onOpen(row)}
      title={
        <span id={anchor} data-row={row.key}>
          {row.label}
        </span>
      }
      detail={
        <>
          <span className="type-caption text-slate-400">{row.source === "authored" ? "Authored" : "Mined"}</span>
          <span className="mt-1 block">{row.what}</span>
          <span className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4" data-role="stage-grid">
            {ROLLOUT_AXES.map((axis, i) => {
              const mark = stageMark(cells[i]);
              return (
                <span key={axis} className="min-w-0">
                  <span className="type-caption block text-slate-400">{axis}</span>
                  <span className="mt-1 inline-flex items-baseline gap-2">
                    <CellMark state={mark.state}>{mark.word}</CellMark>
                    {mark.score != null && <span className="tabular-nums text-slate-100">{mark.score}</span>}
                  </span>
                </span>
              );
            })}
          </span>
          <span className="mt-2 block">
            {assessed ? "not measured" : row.adoptionLabel}
            {row.reachLabel ? `, ${row.reachLabel}` : ""}
          </span>
          <Motion row={row} />
        </>
      }
    />
  );
}
