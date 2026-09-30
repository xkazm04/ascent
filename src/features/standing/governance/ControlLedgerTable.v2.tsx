// The ledger table. Same grouping as the Altimeter card; the shell is the kit table. Coverage that
// was not read is a void, not a dash.
import { CELL, DataTable, HEAD_CELL, VoidMark } from "@/components/kit";
import { coverageSentence, type TimelineRow } from "./controlTimeline";
import { ControlStateV2 } from "./ControlState.v2";

const day = (iso: string) => iso.slice(0, 10);

export function ControlLedgerTableV2({ rows }: { rows: TimelineRow[] }) {
  return (
    <DataTable
      className="mt-4"
      density="compact"
      minWidth={760}
      caption="Control observations by repository and control"
      labelledBy="governance-ledger-heading"
      head={
        <tr>
          <th className={HEAD_CELL}>Repository</th>
          <th className={HEAD_CELL}>Control</th>
          <th className={HEAD_CELL}>State</th>
          <th className={HEAD_CELL}>Last change</th>
          <th className={HEAD_CELL}>Coverage</th>
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={`${r.repoFullName}#${r.controlId}`} className="align-top">
          <td className={`${CELL} text-slate-200`}>{r.repoFullName}</td>
          <td className={CELL}>
            <details>
              <summary className="focus-ring cursor-pointer rounded text-slate-200">{r.label}</summary>
              <ul className="mt-2 space-y-1 type-body-sm text-slate-400">
                {r.observations.map((o) => (
                  <li key={o.id}>
                    {day(o.occurredAt)} · {o.state}
                    {o.value ? ` (${o.value})` : ""} · {o.source}
                    {o.actorLogin ? ` · ${o.actorLogin}` : ""}
                    {o.transition ? " · changed" : ""}
                  </li>
                ))}
              </ul>
            </details>
          </td>
          <td className={CELL}>
            <ControlStateV2 row={r} />
          </td>
          <td className={`${CELL} text-slate-400`}>
            {r.lastChangeAt ? (
              <>
                {day(r.lastChangeAt)}
                {r.lastChangeActor ? <span className="text-slate-400"> · {r.lastChangeActor}</span> : null}
              </>
            ) : (
              <span title="No change observed since this control was first seen.">unchanged</span>
            )}
          </td>
          <td className={`${CELL} text-slate-400`}>
            {coverageSentence(r.coverage) ?? <VoidMark subject="Coverage" label="Not measured" />}
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
