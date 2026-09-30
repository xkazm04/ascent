// Invocation counts only. An unread lane is a void, and skill rows are never invented zeros.

import { Caption, Frame, HairlineList, SectionHead, VoidMark } from "@/components/kit";
import type { RegistryView } from "@/lib/org/registry-view";
import { SINK_LABEL } from "./registryModel";
import { rankInvokesBySkill } from "./RegistryInvokesBySkill";

export function RegistryTelemetryV2({ view }: { view: RegistryView }) {
  const laneRead = Boolean(view.registry?.lastIndexedAt);
  const rows = laneRead ? rankInvokesBySkill(view.telemetry.invokesBySkill) : [];
  return (
    <Frame>
      <SectionHead
        eyebrow="Telemetry"
        title="Invocation counts,"
        named="nothing else."
        lede="Invocation counts only, never prompts, never code."
      />
      <p className="mt-3 type-body-sm text-slate-400">
        The sink is <span className="font-mono text-slate-200">{SINK_LABEL[view.telemetry.sink]}</span>.
      </p>
      <div className="mt-4" data-invokes-by-skill data-state={laneRead ? "measured" : "not-judged"}>
        <Caption>Invokes by skill</Caption>
        {!laneRead ? (
          <div className="mt-2">
            <VoidMark subject="Invokes by skill" label="not measured" />
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-2 type-body-sm text-slate-400">No skill has a recorded invoke in this window.</p>
        ) : (
          <HairlineList className="mt-2 list-none">
            {rows.map((row) => (
              <li key={row.name} data-skill={row.name} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 font-mono type-mono-sm text-slate-300">{row.name}</span>
                <span data-count className="tabular-nums text-slate-100">
                  {row.invokes.toLocaleString()}
                </span>
              </li>
            ))}
          </HairlineList>
        )}
      </div>
    </Frame>
  );
}
