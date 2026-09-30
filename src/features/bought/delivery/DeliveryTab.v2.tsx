// Prism composition. Same four suspense boundaries and the same data panels; each panel picks its v2 view.
import { Suspense } from "react";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import type { OrgScope } from "@/lib/org/scope";
import type { ResolvedWindow } from "@/lib/window";
import { DeliveryTrendDataPanel } from "./DeliveryTrendDataPanel";
import { DeliveryCorePanel } from "./DeliveryCorePanel";
import { UnitEconomicsPanel } from "./ai/UnitEconomicsPanel";
import { DeliveryOutcomesPanel } from "./ai/DeliveryOutcomesPanel";

export function DeliveryTabV2({
  slug,
  scope,
  period,
}: {
  slug: string;
  scope: Promise<OrgScope>;
  period: ResolvedWindow;
}) {
  return (
    <div data-role="delivery-v2" className="space-y-10">
      <Suspense fallback={<OrgTabGap minH="min-h-[20rem]" />}>
        <DeliveryTrendDataPanel slug={slug} scope={scope} period={period} theme="prism" />
      </Suspense>
      <Suspense fallback={<OrgTabGap minH="min-h-[40rem]" />}>
        <DeliveryCorePanel slug={slug} scope={scope} period={period} theme="prism" />
      </Suspense>
      <Suspense fallback={<OrgTabGap minH="min-h-[20rem]" />}>
        <UnitEconomicsPanel slug={slug} period={period} theme="prism" />
      </Suspense>
      <Suspense fallback={<OrgTabGap minH="min-h-[20rem]" />}>
        <DeliveryOutcomesPanel slug={slug} period={period} theme="prism" />
      </Suspense>
    </div>
  );
}
