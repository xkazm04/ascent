// The authorship split as row-level evidence — deployment and failure COUNTS, which is the one thing
// the paired mark above cannot carry and the one thing a skeptical reader will want to check.
// Extracted from DeliveryOutcomes.tsx for the 200-LOC cap, and placed BELOW the graphic per §2.7.
//
// Server-safe — no hooks, no handlers.

import { OrgTable } from "@/components/org/shared/ui";
import { STATE_HINT } from "@/components/org/viz";
import { MIN_DEPLOYMENTS, type OutcomeBucket } from "@/lib/db/delivery-outcomes";
import { scoreHex } from "@/lib/ui";

function Rate({ bucket }: { bucket: OutcomeBucket }) {
  if (bucket.failureRate == null) {
    return (
      <span
        data-state="missing"
        className="font-mono tabular-nums text-slate-500"
        title={`Fewer than ${MIN_DEPLOYMENTS} attributed deployments: too small a sample to state a rate. ${STATE_HINT.missing}`}
      >
        —
      </span>
    );
  }
  // Lower is better for a failure rate — the ramp is inverted, as in FailureSplitMark.
  return (
    <span className="font-mono tabular-nums" style={{ color: scoreHex(Math.max(0, 100 - bucket.failureRate * 4)) }}>
      {bucket.failureRate}%
    </span>
  );
}

export function DeliveryOutcomesTable({ ai, human }: { ai: OutcomeBucket; human: OutcomeBucket }) {
  const rows: { label: string; bucket: OutcomeBucket }[] = [
    { label: "AI-attributed", bucket: ai },
    { label: "Human-authored", bucket: human },
  ];
  return (
    <OrgTable
      caption="Change-failure rate by authorship"
      minWidth={520}
      head={
        <tr className="text-left">
          <th className="px-4 py-3">Authored</th>
          <th className="px-4 py-3 text-right">Deployments</th>
          <th className="px-4 py-3 text-right">Failed</th>
          <th className="px-4 py-3 text-right">Failure rate</th>
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={r.label}>
          <td className="px-4 py-3 text-white">{r.label}</td>
          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{r.bucket.deployments}</td>
          <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{r.bucket.failed}</td>
          <td className="px-4 py-3 text-right">
            <Rate bucket={r.bucket} />
          </td>
        </tr>
      ))}
    </OrgTable>
  );
}
