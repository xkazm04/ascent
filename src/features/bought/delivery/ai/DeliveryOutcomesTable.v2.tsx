// Authorship split as counts. A rate under the sample floor is a void. The printed rate stays paper.
import { CELL, CELL_NUM, DataTable, HEAD_CELL } from "@/components/kit";
import { MIN_DEPLOYMENTS, type OutcomeBucket } from "@/lib/db/delivery-outcomes";
import { Unknown } from "../deliveryV2Marks";

function Rate({ bucket }: { bucket: OutcomeBucket }) {
  if (bucket.failureRate == null) {
    return (
      <span title={`Fewer than ${MIN_DEPLOYMENTS} attributed deployments: too small a sample to state a rate.`}>
        <Unknown label="not measured" />
      </span>
    );
  }
  return <span className="tabular-nums">{bucket.failureRate}%</span>;
}

export function DeliveryOutcomesTableV2({ ai, human }: { ai: OutcomeBucket; human: OutcomeBucket }) {
  const rows = [
    { label: "AI-attributed", bucket: ai },
    { label: "Human-authored", bucket: human },
  ];
  return (
    <DataTable
      density="compact"
      minWidth={520}
      size="sm"
      caption="Change-failure rate by authorship"
      head={
        <tr>
          <th className={HEAD_CELL}>Authored</th>
          <th className={`${HEAD_CELL} text-right`}>Deployments</th>
          <th className={`${HEAD_CELL} text-right`}>Failed</th>
          <th className={`${HEAD_CELL} text-right`}>Failure rate</th>
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={r.label}>
          <td className={CELL}>{r.label}</td>
          <td className={CELL_NUM}>{r.bucket.deployments}</td>
          <td className={CELL_NUM}>{r.bucket.failed}</td>
          <td className={CELL_NUM}><Rate bucket={r.bucket} /></td>
        </tr>
      ))}
    </DataTable>
  );
}
