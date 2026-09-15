// The D9 check battery as a repos × controls matrix — the tab's first graphic below the ledger.
//
// It replaces a column of ten grade-coloured chips inside a table cell. A chip row could show three
// things at once (pass / partial / fail) but not the fourth and most dangerous one: a control that
// never produced a grade wore the same pill as the others in a quieter colour. Here that control is
// hatched by `MatrixGrid` and `rendersValue()` structurally forbids it a numeral, so "did not run"
// cannot be read as "ran and passed" — the passports precedent (ad805e57), applied where the misread
// costs the most.
//
// No "use client": nothing here holds state. `MatrixGrid` carries its own client boundary, so this
// module renders unchanged from the org tab's client register and from the personal lens's server tree.

import { Legend, MatrixGrid, WhyChip } from "@/components/org/viz";
import { CHECK_AXES, matrixRows, statesPresent, type SecurityMatrixInput } from "./securityMatrixModel";

/** The one sentence the ┃ divider used to carry in the caption above the old chip grid. */
const GROUPS_HINT =
  "The first nine columns are posture — controls the repo has wired up. The last, Vulns, is current exposure: open advisories against its dependencies right now.";

export function SecurityCheckMatrix({
  rows,
  className = "",
}: {
  rows: SecurityMatrixInput[];
  className?: string;
}) {
  const mrows = matrixRows(rows);
  const states = statesPresent(mrows);

  return (
    <div className={className}>
      <MatrixGrid axes={CHECK_AXES} rows={mrows} title="D9 control coverage, graded 0–100 per control" />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Legend states={states} />
        <span className="inline-flex items-center gap-1 type-caption text-slate-500">
          posture ▸ exposure
          <WhyChip hint={GROUPS_HINT} label="posture and exposure columns" />
        </span>
      </div>
    </div>
  );
}
