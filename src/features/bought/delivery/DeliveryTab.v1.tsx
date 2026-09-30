// Altimeter composition. Moved unchanged from the entry so the Prism composition can sit beside it.
import { Suspense } from "react";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import type { OrgScope } from "@/lib/org/scope";
import type { ResolvedWindow } from "@/lib/window";
import { DeliveryTrendDataPanel } from "./DeliveryTrendDataPanel";
import { DeliveryCorePanel } from "./DeliveryCorePanel";
import { UnitEconomicsPanel } from "./ai/UnitEconomicsPanel";
import { DeliveryOutcomesPanel } from "./ai/DeliveryOutcomesPanel";

export function DeliveryTabV1({
  slug,
  scope,
  period,
}: {
  slug: string;
  scope: Promise<OrgScope>;
  period: ResolvedWindow;
}) {
  return (
    <div className="stagger-children space-y-6">
      {/* G7-09: the only WINDOWED read on this tab — every other panel reads each repo's latest scan. */}
      <Suspense fallback={<OrgTabGap minH="min-h-[20rem]" />}>
        <DeliveryTrendDataPanel slug={slug} scope={scope} period={period} />
      </Suspense>

      <Suspense fallback={<OrgTabGap minH="min-h-[40rem]" />}>
        <DeliveryCorePanel slug={slug} scope={scope} period={period} />
      </Suspense>

      {/* W3a — unit economics. Its OWN boundary: AgentSession + AiChange are a genuinely independent
          read from the core panel's latest-scan aggregates, and it is windowed where the core is not,
          so folding it in would make the whole tab wait on a query none of the other panels need. */}
      <Suspense fallback={<OrgTabGap minH="min-h-[20rem]" />}>
        <UnitEconomicsPanel slug={slug} period={period} />
      </Suspense>

      {/* W4 — delivery outcomes (DORA + the AI-vs-human failure split). Its own boundary for the same
          reason as unit economics: a windowed read over Deployment + the merge-sha index, independent
          of everything the core panel fetches. */}
      <Suspense fallback={<OrgTabGap minH="min-h-[20rem]" />}>
        <DeliveryOutcomesPanel slug={slug} period={period} />
      </Suspense>
    </div>
  );
}
