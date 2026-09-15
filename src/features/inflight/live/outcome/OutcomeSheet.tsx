"use client";

// THE OUTCOME SHEET — the loop's outcome as a SPREADSHEET, which is the only shape that answers the
// question the operator actually has: *when did this gap get done, and by which run?*
//
// ROW AXIS: a project header row, then one first-class row per GAP under it (the project name never
// repeated). A gap is identified ACROSS runs by its review key, so a gap worked in run 3 and revisited
// in run 7 is ONE row with content in those two columns and blank cells elsewhere — the blanks are
// what makes the timing readable at a glance. COLUMN AXIS: one column per run, chronological, the
// latest emphasised and a live run marked.
//
// A REAL `<table>`, not a CSS grid dressed as one: the frozen left column is `<th scope="row">` (and
// `scope="colgroup"` on a project header), the run headers are `<th scope="col">`, so a screen reader
// reads a cell as repo → gap → run → state. The grid variant of this could not.
//
// Every column — the frozen one included — is drag-resizable, and WIDTH IS DISCLOSURE: a wider column
// reveals the dimension label and the evidence line (OutcomeSheetCell). Widths persist per org.

import { useEffect, useMemo, useRef } from "react";
import { OutcomeSheetHeader } from "./OutcomeSheetHeader";
import { OutcomeGapSheetRow, OutcomeProjectRow } from "./OutcomeSheetRow";
import type { OutcomeMatrix } from "./outcomeMatrix";
import { buildSheetProjects, type CellReviewHandler } from "./outcomeSheetModel";
import { LABEL_COLUMN, useColumnWidths } from "./useColumnWidths";

export interface OutcomeSheetProps {
  matrix: OutcomeMatrix;
  /** The org — the localStorage key for this sheet's widths, and the PR action's address. */
  slug: string;
  selectedId: string | null;
  onOpen: (id: string) => void;
  /** The owner's quick-approval gate — absent for a viewer who cannot rule. */
  canReview?: boolean;
  onReview?: CellReviewHandler;
}

export function OutcomeSheet({ matrix, slug, selectedId, onOpen, canReview, onReview }: OutcomeSheetProps) {
  const { widthOf, setWidth } = useColumnWidths(slug, matrix.latestId);
  const projects = useMemo(() => buildSheetProjects(matrix), [matrix]);
  const latestRef = useRef<HTMLTableCellElement | null>(null);
  useEffect(() => {
    // jsdom has no scrollIntoView; the optional call keeps the dom tests honest about that.
    latestRef.current?.scrollIntoView?.({ inline: "end", block: "nearest" });
  }, [matrix.latestId]);

  const width = matrix.columns.reduce((n, c) => n + widthOf(c.id), widthOf(LABEL_COLUMN));

  return (
    <div className="overflow-x-auto rounded-2xl border border-divider bg-ink">
      <table className="table-fixed border-separate border-spacing-0 text-left" style={{ width }} aria-label="Outcome by gap and run">
        <colgroup>
          <col style={{ width: widthOf(LABEL_COLUMN) }} />
          {matrix.columns.map((c) => (
            <col key={c.id} style={{ width: widthOf(c.id) }} />
          ))}
        </colgroup>
        <OutcomeSheetHeader
          columns={matrix.columns}
          latestId={matrix.latestId}
          selectedId={selectedId}
          widthOf={widthOf}
          setWidth={setWidth}
          onOpen={onOpen}
          latestRef={(el) => void (latestRef.current = el)}
        />
        {projects.map((project) => (
          <tbody key={project.repo}>
            <OutcomeProjectRow project={project} columns={matrix.columns} slug={slug} canOpenPr={canReview === true} />
            {project.rows.map((row) => (
              <OutcomeGapSheetRow
                key={row.key}
                row={row}
                columns={matrix.columns}
                widthOf={widthOf}
                canReview={canReview}
                onReview={onReview}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
