// Expanded passport facts in Prism. The decision lists are the same components as Altimeter, with
// status drawn as a glyph and a sentence. A missing coverage figure stays the word "unknown".
import { GhostAction, KeyValue } from "@/components/kit";
import type { DecisionMap } from "@/lib/org/decision-map";
import { BlockerList, DeclinedList } from "./PassportDetailLists";
import type { PassportDetail } from "./PassportRowDetail";

function Mark({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="type-caption text-slate-300">
      <span aria-hidden>{ok ? "✓" : "×"} </span>
      <span className="sr-only">{ok ? "present" : "absent"}: </span>
      {label}
    </span>
  );
}

export function PassportFactsV2({
  fullName,
  detail,
  org,
  decisions,
}: {
  fullName: string;
  detail: PassportDetail;
  org: string;
  decisions: DecisionMap;
}) {
  const d = detail;
  const sv = d.selfVerify;
  return (
    <div className="grid gap-6 px-4 py-4 md:grid-cols-2">
      <div className="space-y-4">
        <BlockerList plain title="Automation blockers" items={d.autoBlockers} findings={d.autoFindings} allClear="No automation blockers. Agents can work here." org={org} fullName={fullName} decisions={decisions} declined={d.declined} />
        <BlockerList plain title="Production blockers" items={d.prodBlockers} findings={d.prodFindings} allClear="No production blockers on record." org={org} fullName={fullName} decisions={decisions} declined={d.declined} />
        <DeclinedList plain items={d.declined ?? []} />
      </div>
      <KeyValue
        layout="stack"
        items={[
          {
            key: "Self-verify",
            value: (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                <Mark ok={sv.build} label="build" />
                <Mark ok={sv.test} label="test" />
                <Mark ok={sv.lint} label="lint" />
                <Mark ok={sv.typecheck} label="typecheck" />
                <Mark ok={d.aiInWorkflow} label="AI in workflow" />
              </span>
            ),
          },
          {
            key: "CI",
            value: (
              <>
                {d.ciProvider ?? "not detected"}
                {d.ciGates.length > 0 && <span className="text-slate-400">, gates: {d.ciGates.join(", ")}</span>}
              </>
            ),
          },
          {
            key: "Tests",
            value: (
              <>
                {d.coveragePct != null ? `${d.coveragePct}% coverage` : "coverage unknown"}
                <span className="text-slate-400">, critical path {d.criticalPathCovered ? "covered" : "not covered"}</span>
              </>
            ),
          },
          { key: "Security", value: d.securityTools.length > 0 ? d.securityTools.join(", ") : "no tools detected" },
          {
            key: "Delivery",
            value: (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                <Mark ok={d.delivery.migrations !== "none"} label={`migrations: ${d.delivery.migrations}`} />
                <Mark ok={d.delivery.iac} label="IaC" />
                <Mark ok={d.delivery.rollback} label="rollback" />
              </span>
            ),
          },
          ...(d.stack.length > 0 ? [{ key: "Stack", value: d.stack.join(", ") }] : []),
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-3 md:col-span-2">
        <span className="min-w-0 truncate text-[0.9375rem] text-slate-400" title={d.purpose}>
          {d.purpose} · scan confidence {Math.round(d.confidence * 100)}%
        </span>
        <GhostAction href={`/report?repo=${encodeURIComponent(fullName)}`}>Full report</GhostAction>
      </div>
    </div>
  );
}
