// Receipt rows. A missing delta is not measured. A verified number, including 0, stays paper.
import { CELL, CELL_NUM, CellMark, DataTable, DimensionMark, HEAD_CELL, VoidMark } from "@/components/kit";
import type { ImpactLedger } from "@/lib/db/org-impact";
import { signed, SOURCE_LABEL, SOURCE_TITLE } from "./ImpactLedgerCells";
import { IMPACT_IN_REVIEW_HINT, IMPACT_NO_SUM_HINT } from "./impactView";

function deltaCell(value: number | null, verified: boolean) {
  if (value == null) {
    return <VoidMark label="not measured" subject={verified ? "Baseline" : "Rescan"} />;
  }
  return <span className="tabular-nums text-white">{signed(value)}</span>;
}

export function impactTableV2(ledger: ImpactLedger) {
  return (
    <DataTable
      variant="plain"
      size="sm"
      density="compact"
      minWidth={760}
      caption="Merged improvement PRs and their measured impact"
      head={
        <tr>
          <th className={HEAD_CELL}>Repository</th>
          <th className={HEAD_CELL}>Bought</th>
          <th className={HEAD_CELL}>Dim delta</th>
          <th className={HEAD_CELL} title={IMPACT_NO_SUM_HINT}>Repo overall</th>
          <th className={HEAD_CELL} title={IMPACT_IN_REVIEW_HINT}>Source</th>
          <th className={HEAD_CELL}>Status</th>
        </tr>
      }
    >
      {ledger.rows.map((row) => (
        <tr key={`${row.repoFullName}:${row.prNumber}`}>
          <td className={CELL}>
            <a href={`https://github.com/${row.repoFullName}`} className="focus-ring font-medium text-white">
              {row.repoName}
            </a>
            <div className="text-slate-400">{new Date(row.mergedAt).toISOString().slice(0, 10)}</div>
          </td>
          <td className={CELL}>
            <a href={row.prUrl} className="focus-ring text-slate-200">
              {row.practiceLabel} <span className="text-slate-400">#{row.prNumber}</span>
            </a>
            <div className="mt-1">
              <DimensionMark id={row.dimId} label={row.practiceLabel} />
            </div>
          </td>
          <td className={CELL_NUM}>{deltaCell(row.verified ? row.impactDim : null, row.verified)}</td>
          <td className={CELL_NUM}>{deltaCell(row.verified ? row.impactOverall : null, row.verified)}</td>
          <td className={CELL} title={SOURCE_TITLE[row.source]}>
            {SOURCE_LABEL[row.source] ?? row.source}
          </td>
          <td className={CELL}>
            {row.verified ? (
              <CellMark state="met">verified</CellMark>
            ) : (
              <CellMark state="unmeasured">awaiting rescan</CellMark>
            )}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
