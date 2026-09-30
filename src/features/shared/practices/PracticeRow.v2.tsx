"use client";

// One practice in the Prism library. Stages are words (or a void), never a score painted on a ramp.
// The row is a button: ListRow is not pressable (kit gap).
import { Movement, VoidMark } from "@/components/kit";

// Caption and Lede render paragraphs. A paragraph inside this button is invalid and the browser
// hoists it out, so the stage labels use the caption type on a span (kit gap: no phrasing caption).
import { ROLLOUT_AXES } from "./practiceRolloutViz";
import type { RolloutEntry } from "./practiceRolloutGroups";
import type { PracticeRow } from "./practiceRows";

type Cell = RolloutEntry["cells"][number];

function stageText(cell: Cell | undefined): { kind: "void" | "text"; text: string } {
  if (!cell || cell.state === "missing" || cell.state === "not-judged") return { kind: "void", text: "not measured" };
  if (cell.state === "declared") {
    return { kind: "text", text: typeof cell.score === "number" ? `declared ${cell.score}` : "declared" };
  }
  if (typeof cell.score === "number") return { kind: "text", text: String(cell.score) };
  return { kind: "text", text: "landed" };
}

function Motion({ row }: { row: PracticeRow }) {
  const rollout = row.rollout;
  if (!rollout || (rollout.open === 0 && rollout.merged === 0)) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 text-slate-400" data-motion>
      {rollout.open > 0 && <span>{rollout.open} in flight</span>}
      {rollout.merged > 0 && <span>{rollout.merged} landed</span>}
      {rollout.merged > 0 && rollout.lift == null && <span>awaiting rescan</span>}
      {rollout.lift != null && rollout.lift !== 0 && (
        <Movement delta={rollout.lift} basis="avg" toneClass={() => "text-slate-200"} />
      )}
      {rollout.lift === 0 && <span className="text-slate-200">0 avg</span>}
    </span>
  );
}

export function PracticeRowV2({ entry, onOpen }: { entry: RolloutEntry; onOpen: (row: PracticeRow) => void }) {
  const { row, cells } = entry;
  const assessed = row.source === "mined" && (row.mined?.total ?? 0) === 0;
  return (
    <button
      type="button"
      id={row.source === "mined" ? `practice-${row.id}` : undefined}
      data-row={row.key}
      onClick={() => onOpen(row)}
      className="focus-ring w-full py-3 text-left"
      aria-label={`Open ${row.label}`}
    >
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-slate-100">{row.label}</span>
        <span className="type-caption text-slate-400">{row.source === "authored" ? "Authored" : "Mined"}</span>
      </span>
      <span className="mt-1 block text-slate-400">{row.what}</span>
      <span className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {ROLLOUT_AXES.map((axis, i) => {
          const stage = stageText(cells[i]);
          return (
            <span key={axis} className="min-w-0">
              <span className="type-caption block text-slate-400">{axis}</span>
              {stage.kind === "void" ? (
                <span className="mt-1 inline-flex items-center gap-2 text-slate-400">
                  <VoidMark subject={`${row.label}, ${axis}`} label={`${row.label}, ${axis}: not measured`} />
                  not measured
                </span>
              ) : (
                <span className="mt-1 block tabular-nums text-slate-100">{stage.text}</span>
              )}
            </span>
          );
        })}
      </span>
      <span className="mt-2 block text-slate-400">
        {assessed ? "not measured" : row.adoptionLabel}
        {row.reachLabel ? `, ${row.reachLabel}` : ""}
      </span>
      <Motion row={row} />
    </button>
  );
}
