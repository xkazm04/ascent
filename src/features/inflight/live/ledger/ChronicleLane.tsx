// ONE LANE OF A PAST RUN, as the chronicle tells it: repo · cycle · phase · the guard's verdict and rung
// · commits · verified closes · landed · cost · the plan it ran under · what it delivered · the flow from
// what was offered to what was verified · its log's last lines · the lessons its report kept.
//
// No hooks: the log and the report sit in native <details>, so the row is a pure rendering.

import { FlowRibbon } from "@/components/org/viz/FlowRibbon";
import { verifyVerdictTag, type LoopLaneRecord } from "../cockpit/loopTypes";
import { LANE_LOG_TAIL, laneFlow, logTail } from "./chronicleModel";
import { fmtUsd, plural, shortRepo } from "./ledgerFormat";
import { LEDGER_ANCHOR } from "./ledgerModel";
import type { LoopPlanRecord } from "./ledgerTypes";

function planHref(plan: LoopPlanRecord): string {
  if (plan.directionId) return `#direction-${plan.directionId}`;
  return `#${LEDGER_ANCHOR.needsYou}`;
}

export function ChronicleLane({ lane, plan }: { lane: LoopLaneRecord; plan: LoopPlanRecord | null }) {
  const flow = laneFlow(lane);
  const verdict = verifyVerdictTag(lane.verifyVerdict);
  const rung = lane.verifyRung && lane.verifyRung !== "primary" ? `${lane.verifyRung} only` : lane.verifyRung;
  const tail = logTail(lane);
  const lessons = lane.report?.lessons ?? [];
  // A review marker (`isReviewMarker`, loop-runs-types.ts: a `noted` row whose headline is its one cover)
  // is a ruling, not a deliverable — the same filter every other surface applies.
  const headlines = lane.deliverables.filter((d) => d.headline && !(d.kind === "noted" && d.covers.length === 1 && d.headline === d.covers[0]));
  return (
    <li data-testid="chronicle-lane" className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_220px]">
      <div className="min-w-0 space-y-1.5">
        <p className="flex flex-wrap items-baseline gap-x-2 type-body-sm text-slate-100">
          <span className="font-mono" title={lane.repoFullName}>{shortRepo(lane.repoFullName)}</span>
          <span className="type-caption text-slate-500">
            cycle {lane.cycle} · {lane.phase}
          </span>
          {verdict && (
            <span className={`type-caption ${lane.verifyVerdict === "rejected" ? "text-danger" : "text-slate-400"}`} title={lane.verifyNote ?? undefined}>
              {verdict}
              {rung ? ` · ${rung}` : ""}
            </span>
          )}
        </p>
        <p className="flex flex-wrap gap-x-3 type-caption tabular-nums text-slate-400">
          <span>{plural(lane.commits, "commit")}</span>
          <span title="Follow-ups this lane's rescan VERIFIED closed — an agent's unconfirmed claim is not counted.">{lane.closedIds.length} verified closed</span>
          <span>{lane.landedAt ? "landed" : "not landed"}</span>
          <span title="From the agent's own session envelope; — is not measured, never free.">{fmtUsd(lane.costMicros)}</span>
          {plan ? (
            <a href={planHref(plan)} className="focus-ring rounded text-accent hover:text-accent-soft" title={`Plan ${plan.id}`}>
              plan {plan.status} · {plan.cls}
            </a>
          ) : lane.planId ? (
            <span className="text-slate-500" title={lane.planId}>plan (not in the recent list)</span>
          ) : null}
        </p>
        {headlines.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 type-body-sm text-slate-300">
            {headlines.slice(0, 4).map((d, i) => (
              <li key={i}>{d.headline}</li>
            ))}
          </ul>
        )}
        {lane.error && <p className="type-caption text-danger">{lane.error}</p>}
        {tail.length > 0 && (
          <details>
            <summary className="focus-ring cursor-pointer type-caption text-slate-500">log · last {Math.min(LANE_LOG_TAIL, tail.length)} lines</summary>
            <pre data-testid="lane-log" className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded border border-divider bg-surface-strong/60 p-2 font-mono type-micro text-slate-400">
              {tail.join("\n")}
            </pre>
          </details>
        )}
        {lessons.length > 0 && (
          <details>
            <summary className="focus-ring cursor-pointer type-caption text-slate-500">{plural(lessons.length, "lesson")} from the lane&apos;s report</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 type-body-sm text-slate-300">
              {lessons.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div data-testid="lane-flow" title={flow.proposedTitle}>
        <FlowRibbon stages={flow.stages} title={`${shortRepo(lane.repoFullName)} cycle ${lane.cycle}: proposed, armed, ${flow.landed ? "landed" : "delivered"}`} />
      </div>
    </li>
  );
}
