// Body of the core region.
import { Frame, Lede } from "@/components/kit";
import { Defer } from "@/components/ui/Defer";
import { AiDeliveryModuleViewChunk } from "./DeliveryTabChunks";
import { DeliveryActivity } from "./DeliveryActivity";
import { DeliveryGov } from "./DeliveryGov";
import { DeliveryMasthead } from "./DeliveryMasthead";
import { DeliveryNotice } from "./DeliveryNotice";
import { DeliveryPr } from "./DeliveryPr";
import { DeliveryPriorities } from "./DeliveryPriorities";
import type { DeliveryCoreViewProps } from "./deliveryCoreView";

function Failed({ children }: { children: string }) {
  return (
    <Frame pad="sm">
      <Lede>{children}</Lede>
    </Frame>
  );
}

const WITHHOLD =
  "AI spend for this org is connected only as a whole-org total (allocated), which has no per-repo breakdown, so splitting it across a filtered segment/stack would inflate the dollar figures. Clear the filter to see AI delivery ROI, or connect per-repo telemetry for filterable spend.";

export function DeliveryCore(v: DeliveryCoreViewProps) {
  const empty = !v.pr && !v.gov && !v.activity;
  return (
    <div className="space-y-10">
      <DeliveryMasthead {...v} />
      {!empty && <DeliveryNotice period={v.period} />}
      {!empty && (v.pr || v.gov) && <DeliveryPriorities pr={v.pr} gov={v.gov} />}
      {!empty && v.prFailed && <Failed>Pull request signals couldn&apos;t load right now. Try refreshing this page.</Failed>}
      {!empty && v.govFailed && <Failed>Branch governance couldn&apos;t load right now. Try refreshing this page.</Failed>}
      {!empty && v.activityFailed && <Failed>Commit activity couldn&apos;t load right now. Try refreshing this page.</Failed>}
      {v.spendKind === "unavailable" && v.pr && <Failed>{v.aiUnavailable}</Failed>}
      {v.aiModel && !v.withholdAllocatedRoi && (
        <Defer strategy="idle">
          <AiDeliveryModuleViewChunk model={v.aiModel} slug={v.slug} />
        </Defer>
      )}
      {v.aiModel && v.withholdAllocatedRoi && (
        <Frame pad="sm">
          <Lede>{WITHHOLD}</Lede>
        </Frame>
      )}
      {v.pr && <DeliveryPr pr={v.pr} />}
      {v.gov && <DeliveryGov gov={v.gov} />}
      {v.activity && <DeliveryActivity activity={v.activity} />}
    </div>
  );
}
