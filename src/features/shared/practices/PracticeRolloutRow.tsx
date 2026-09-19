"use client";

// One practice in the library: who it is, its four rollout stages, and the counts beside them.
//
// The stage cells are MatrixGrid's ledger cells, painted by the same kit (`MatrixMark`, `cellInk`,
// `rendersValue`), so a hatched or void stage structurally cannot print a numeral. What the row adds
// over a MatrixGrid row — and why it is not one — is what the retired PracticeLedger carried: the
// description, the Authored/Mined source, the counts column, and that the row OPENS the practice
// (detail modal: exemplar, gap repos, apply). A MatrixGrid is one `role="img"`, which cannot hold a
// control; here each stage is its own named image and the practice name is the button.

import { scoreHex } from "@/lib/ui";
import { STATE_LABEL, fmtNum, isNum, isStruck, rendersValue, stateTitle, type MatrixCell } from "@/components/org/viz";
import { MatrixMark, cellInk } from "@/components/org/viz/matrixMark";
import type { PracticeRow } from "./practiceRows";
import { ROLLOUT_AXES } from "./practiceRolloutViz";
import type { RolloutEntry } from "./practiceRolloutGroups";
import { PracticeRolloutReadout } from "./PracticeRolloutReadout";

/** Practice · four stages · counts. One template for the head and every row. */
export const ROLLOUT_TEMPLATE = `minmax(15rem, 1fr) repeat(${ROLLOUT_AXES.length}, minmax(3.5rem, 4.75rem)) minmax(10rem, 12rem)`;

const FILL_ALPHA = 0.55;
const VOID: MatrixCell = { state: "missing" };

function StageCell({ row, axis, cell }: { row: PracticeRow; axis: string; cell: MatrixCell }) {
  const base = isNum(cell.score) ? scoreHex(cell.score) : undefined;
  const printed = rendersValue(cell.state) && isNum(cell.score);
  const ink = cellInk(cell, FILL_ALPHA);
  const value = printed ? ` ${fmtNum(cell.score, 0)}` : "";
  return (
    <div
      role="img"
      aria-label={`${row.label} — ${axis}: ${STATE_LABEL[cell.state]}${value}`}
      data-cell={`${row.key}:${axis}`}
      data-state={cell.state}
      title={stateTitle(cell.state, `${row.label} · ${axis}`)}
      className="relative h-10"
    >
      <MatrixMark state={cell.state} base={base} alpha={FILL_ALPHA} />
      {printed && (
        <span
          data-score
          className={`absolute inset-0 grid place-items-center font-mono type-mono-sm font-medium tabular-nums${ink ? "" : " text-slate-200"}`}
          style={ink ? { color: ink } : undefined}
        >
          {fmtNum(cell.score, 0)}
        </span>
      )}
      {isStruck(cell.state) && <span data-strike className="absolute inset-x-4 top-1/2 h-px bg-divider" />}
    </div>
  );
}

function SourcePill({ source }: { source: PracticeRow["source"] }) {
  const authored = source === "authored";
  return (
    <span
      className={`whitespace-nowrap rounded border px-1.5 py-px type-micro font-mono uppercase tracking-wider ${
        authored ? "border-accent/40 bg-accent/10 text-accent" : "border-slate-700 text-slate-400"
      }`}
    >
      {authored ? "Authored" : "Mined"}
    </span>
  );
}

export function PracticeRolloutRow({ entry, onOpen }: { entry: RolloutEntry; onOpen: (row: PracticeRow) => void }) {
  const { row, cells } = entry;
  return (
    <div
      // The deep-link anchor the briefing, initiatives and overview route to (`#practice-<id>`).
      // Mined practices only — every call site interpolates a catalogued practice id. See usePracticeHash.
      id={row.source === "mined" ? `practice-${row.id}` : undefined}
      data-row={row.key}
      onClick={() => onOpen(row)}
      className="group grid cursor-pointer items-center border-b border-divider/50 py-1.5 transition-colors last:border-b-0 hover:bg-surface/40"
      style={{ gridTemplateColumns: ROLLOUT_TEMPLATE }}
    >
      <div className="min-w-0 pr-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(row);
            }}
            title={`Open ${row.label} — exemplar, gap repos and apply actions`}
            className="focus-ring rounded text-left type-body-sm font-medium text-white transition group-hover:text-accent"
          >
            {row.label}
          </button>
          <SourcePill source={row.source} />
        </div>
        <p className="mt-0.5 line-clamp-1 type-caption text-slate-500" title={row.what}>
          {row.what}
        </p>
      </div>
      {ROLLOUT_AXES.map((axis, i) => (
        <StageCell key={axis} row={row} axis={axis} cell={cells[i] ?? VOID} />
      ))}
      <PracticeRolloutReadout row={row} />
    </div>
  );
}
