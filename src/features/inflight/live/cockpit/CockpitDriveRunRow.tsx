// ONE ROW OF THE DRIVE'S RUN LEDGER. Extracted from CockpitDrivePanel so that file stays the panel
// and this one can carry the model-switch basis without pushing it over the 200-line cap.
//
// No hooks, no handlers — deliberately NOT a client module of its own. It renders inside the panel,
// which is already `"use client"`, and adding the directive to a file that needs none would drag a
// boundary where there is no boundary.
//
// DEBT INVERTS THE HOUSE DELTA CONVENTION here exactly as it does in the panel: the colour takes the
// size of the DROP, the text prints the signed change in the debt itself, and `signedDelta` is used
// rather than `fmtDelta` so no ▲/▼ glyph contradicts the colour beside it.

import { deltaHex, signedDelta } from "@/components/ui";
import type { DriveRunRecord } from "./driveTypes";

export function DriveRunRow({ record, index }: { record: DriveRunRecord; index: number }) {
  const moved = record.debtAfter != null ? record.debtBefore - record.debtAfter : null;
  return (
    <li className="bg-ink px-4 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="type-caption text-slate-400">
          run {index + 1} · {record.repos.length} {record.repos.length === 1 ? "repo" : "repos"}
        </span>
        <span className="type-caption tabular-nums">
          {moved == null ? (
            <span className="text-slate-600">in flight</span>
          ) : (
            <>
              <span className="text-slate-500">
                {record.debtBefore} → {record.debtAfter}
              </span>
              <span className="ml-2" style={{ color: deltaHex(moved) }}>
                {signedDelta(-moved)}
              </span>
            </>
          )}
        </span>
      </div>
      {/* WHY THIS RUN IS NOT ON THE MODEL YOU PICKED (PRIYA-L1-705). The drive substitutes a model
          when the org's own price list carries the decision, and until this line the substitution
          reached the operator as nothing at all — an unexplained change of the thing they chose. The
          line carries the prices compared and the `n` behind each, because an evidence-led decision
          that cannot show its evidence is indistinguishable from a guess (G18). Absent on a run that
          was NOT switched: silence here means "the model you configured stood". */}
      {record.modelBasis && <p className="mt-1 type-micro leading-relaxed text-slate-500">{record.modelBasis}</p>}
    </li>
  );
}
