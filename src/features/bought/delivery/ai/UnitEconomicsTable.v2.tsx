// Per-repo unit-economics ledger. A missing rate is a void. Row spend uses the shared usd().
import { CELL, CELL_NUM, DataTable, HEAD_CELL } from "@/components/kit";
import type { UnitEconomicsView } from "@/lib/db/unit-economics";
import { usd } from "./UnitEconomicsTable";
import { Unknown } from "../deliveryV2Marks";

export function UnitEconomicsTableV2({ view }: { view: UnitEconomicsView }) {
  return (
    <DataTable
      density="compact"
      stickyFirstCol
      minWidth={720}
      size="sm"
      caption="Per-repository unit economics"
      head={
        <tr>
          <th className={HEAD_CELL}>Repository</th>
          <th className={`${HEAD_CELL} text-right`}>Sessions</th>
          <th className={`${HEAD_CELL} text-right`}>Produced code</th>
          <th className={`${HEAD_CELL} text-right`}>Spend</th>
          <th className={`${HEAD_CELL} text-right`}>Per producing session</th>
          <th className={`${HEAD_CELL} text-right`}>Per merged AI change</th>
        </tr>
      }
    >
      {view.rows.map((r) => (
        <tr key={r.repoFullName}>
          <td className={CELL}>{r.repoFullName}</td>
          <td className={CELL_NUM}>{r.sessions}</td>
          <td className={CELL_NUM}>{r.producedRate == null ? <span title="No sessions"><Unknown /></span> : `${r.producedRate}%`}</td>
          <td className={CELL_NUM}>{usd(r.costCents)}</td>
          <td className={CELL_NUM}>
            {r.costPerProducingSession == null ? (
              <span title="No session in this repo produced a commit or PR"><Unknown label="no output" /></span>
            ) : (
              usd(r.costPerProducingSession)
            )}
          </td>
          <td className={CELL_NUM}>
            {r.costPerMergedAiChange == null ? (
              <span title="No AI-attributed change merged in this repo during the period: no denominator, which is not the same as free">
                <Unknown label="no denominator" />
              </span>
            ) : (
              <span title={`over ${r.mergedAiChanges} merged AI changes`}>{usd(r.costPerMergedAiChange)}</span>
            )}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
