// The product surface the six regions act on: a fleet scan ledger. Every cell renders through a
// primitive from primitives.tsx — the pill takes the wire token, `Num` and `Elapsed` bind the
// locale from context, `Label` renders the outside-authored repo name as text. The regions below
// the table hold the controls (locale, sort, skew, rename, colour); this table only reacts. No hooks.

import { motion } from "framer-motion";
import type { ScanRow } from "./fixtures";
import { Elapsed, Label, Num, SeverityPill, StatusPill } from "./primitives";
import { TD, TH } from "./sceneParts";

export function Ledger({ rows, instantOf, noColor, reduced }: { rows: ScanRow[]; instantOf: (r: ScanRow) => number; noColor: boolean; reduced: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-divider bg-surface/40" data-ledger data-no-color={noColor} style={noColor ? { filter: "grayscale(1)" } : undefined}>
      <table className="w-full min-w-[52rem] type-caption">
        <thead>
          <tr className="text-slate-500">
            <th className={TH}>repository</th>
            <th className={TH}>status</th>
            <th className={TH}>top finding</th>
            <th className={`${TH} text-right`}>cost</th>
            <th className={`${TH} text-right`}>tokens</th>
            <th className={`${TH} text-right`}>pass rate</th>
            <th className={TH}>finished</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <motion.tr
              key={r.id}
              data-row={r.id}
              className="px-2 text-slate-300"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.24 }}
            >
              <td className={`${TD} pl-3`}>
                <Label text={r.repo} />
              </td>
              <td className={TD}>
                <StatusPill token={r.status} />
              </td>
              <td className={TD}>
                <SeverityPill token={r.topSeverity} />
              </td>
              <td className={`${TD} text-right`}>
                <Num value={r.costUsd} unit="usd" />
              </td>
              <td className={`${TD} text-right`}>
                <Num value={r.tokens} unit="compact" />
              </td>
              <td className={`${TD} text-right`}>
                <Num value={r.passRate} unit="percent" />
              </td>
              <td className={TD}>
                <Elapsed instant={instantOf(r)} />
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
