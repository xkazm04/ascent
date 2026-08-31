"use client";

// THE SHEET'S TWO ROW SHAPES.
//
// 1. THE PROJECT HEADER ROW — the repo named ONCE, as a group header (`bg-surface/60`), its label
//    spanning the sheet's frozen left edge with the lane's PR (a link once one is open, the guarded
//    "open a PR" action before that) and the repo's cumulative attributable lift. Its run cells carry
//    that run's verdict for the repo — a delta, a refusal word, or the live stage caption.
//
// 2. THE GAP ROWS beneath it — one FIRST-CLASS sheet row per gap, the project name never repeated.
//    The row label is the gap's headline in the frozen column; the run cells are OutcomeSheetCell.
//
// The frozen column is `<th scope="row">` / `<th scope="colgroup">` on purpose: a screen reader
// reading a cell must be able to say repo → gap → run → state, which an all-`<td>` grid cannot.

import { deltaHex, fmtDelta } from "@/components/ui";
import { LanePrAction } from "../cockpit/LanePrAction";
import { CellLive, CellVerdict, cellInFlight } from "./OutcomeCell";
import { OutcomeSheetCell } from "./OutcomeSheetCell";
import { economicsLabel } from "./outcomeEconomics";
import { cellFootnote } from "./outcomeText";
import type { OutcomeCell, OutcomeColumn } from "./outcomeMatrix";
import { prCell, type CellReviewHandler, type SheetGapRow, type SheetProject } from "./outcomeSheetModel";
import { LABEL_COLUMN, REVEAL_DIM_PX } from "./useColumnWidths";

const FROZEN = "sticky left-0 z-10 border-b border-r border-divider text-left align-top";

/** The cell's remediation economics, one muted line under the verdict. Renders nothing when the
 *  payload carried no lane economics — a server older than the ledger says nothing, not "0". */
function CellEconomics({ cell }: { cell: OutcomeCell }) {
  const label = economicsLabel(cell.economics);
  if (!label) return null;
  return (
    <p
      className={`type-micro mt-1 font-mono tabular-nums ${label.warn ? "text-warn" : "text-slate-600"}`}
      title={label.title}
      data-testid="cell-economics"
    >
      {label.text}
    </p>
  );
}

export function OutcomeProjectRow({
  project,
  columns,
  slug,
  canOpenPr,
}: {
  project: SheetProject;
  columns: OutcomeColumn[];
  slug: string;
  canOpenPr: boolean;
}) {
  const pr = prCell(project, columns);
  return (
    <tr>
      <th scope="colgroup" className={`${FROZEN} bg-ink p-0`}>
        <div className="flex items-baseline gap-2 bg-surface/60 px-3 py-2">
          <span className="type-mono-sm min-w-0 flex-1 truncate text-slate-200" title={project.repo}>
            {project.repo}
          </span>
          {pr && <LanePrAction slug={slug} lane={pr.lane} canOpen={canOpenPr} />}
          <span className="type-mono-sm shrink-0 tabular-nums" style={{ color: deltaHex(project.lift ?? 0) }}>
            {project.lift == null ? "—" : fmtDelta(project.lift)}
          </span>
        </div>
      </th>
      {columns.map((col) => {
        const cell = project.headerCells[col.id];
        return (
          <td key={col.id} className="border-b border-l border-divider bg-surface/60 px-2 py-2 align-top">
            {!cell ? null : (
              <span className="flex items-baseline justify-between gap-2">
                {cellInFlight(cell) ? <CellLive cell={cell} /> : <CellVerdict cell={cell} />}
                <span className="type-micro shrink-0 font-mono tabular-nums text-slate-600">{cellFootnote(cell.commits, cell.gaps)}</span>
              </span>
            )}
            {/* A RED BASELINE, as a WORD beside the verdict and never a panel — the lane rail's own
                rule. It IS coloured, unlike the rail's `unverified`: this is not the neutral fact
                "we did not check", it is "we could not check, and everything in this column is
                therefore unverified". The full guard note is on hover, where "why" survives the
                throwaway worktree it happened in. */}
            {cell?.redBaseline && (
              <p
                data-testid="cell-baseline-red"
                className="type-micro mt-1 font-mono text-warn"
                title={cell.redBaseline.note ?? undefined}
              >
                baseline red
              </p>
            )}
            {/* WHAT THIS RUN SPENT ON THIS REPO, per verified point (UAT PRIYA-L1-704). The figure
                has been on the wire since the ledger landed and was rendered nowhere; the only
                ¢/point on the page was the ORG-WIDE average, which is precisely what hid a lane
                spending $10.19 for 0 verified points. `economicsLabel` decides what may honestly be
                said — a rate, spend-with-a-zero, spend-not-yet-divisible, or "cost not reported". */}
            {cell && <CellEconomics cell={cell} />}
            {cell?.error && <p className="type-micro mt-1 text-danger">{cell.error}</p>}
          </td>
        );
      })}
    </tr>
  );
}

export function OutcomeGapSheetRow({
  row,
  columns,
  widthOf,
  canReview,
  onReview,
}: {
  row: SheetGapRow;
  columns: OutcomeColumn[];
  widthOf: (id: string) => number;
  canReview?: boolean;
  onReview?: CellReviewHandler;
}) {
  const labelWidth = widthOf(LABEL_COLUMN);
  return (
    <tr>
      <th scope="row" className={`${FROZEN} bg-ink px-3 py-1.5 font-normal`}>
        <span className="type-body-sm block truncate text-slate-300" title={row.headline}>
          {row.headline}
        </span>
        {labelWidth >= REVEAL_DIM_PX && row.dimId && (
          <span className="type-micro block font-mono tabular-nums text-slate-600">{row.dimId}</span>
        )}
      </th>
      {columns.map((col) => (
        <OutcomeSheetCell key={col.id} cell={row.cells[col.id] ?? null} width={widthOf(col.id)} canReview={canReview} onReview={onReview} />
      ))}
    </tr>
  );
}
