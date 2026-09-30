// Prism body of the core region. Same resolved view as DeliveryCore.v1, composed from the kit.
import { Frame, Lede } from "@/components/kit";
import { Defer } from "@/components/ui/Defer";
import { AiDeliveryModuleV2Chunk } from "./DeliveryTabChunks";
import { DeliveryActivityV2 } from "./DeliveryActivity.v2";
import { DeliveryGovV2 } from "./DeliveryGov.v2";
import { DeliveryMastheadV2 } from "./DeliveryMasthead.v2";
import { DeliveryNoticeV2 } from "./DeliveryNotice.v2";
import { DeliveryPrV2 } from "./DeliveryPr.v2";
import { DeliveryPrioritiesV2 } from "./DeliveryPriorities.v2";
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

export function DeliveryCoreV2(v: DeliveryCoreViewProps) {
  const empty = !v.pr && !v.gov && !v.activity;
  return (
    <div className="space-y-10">
      <DeliveryMastheadV2 {...v} />
      {!empty && <DeliveryNoticeV2 period={v.period} />}
      {!empty && (v.pr || v.gov) && <DeliveryPrioritiesV2 pr={v.pr} gov={v.gov} />}
      {!empty && v.prFailed && <Failed>Pull request signals couldn&apos;t load right now. Try refreshing this page.</Failed>}
      {!empty && v.govFailed && <Failed>Branch governance couldn&apos;t load right now. Try refreshing this page.</Failed>}
      {!empty && v.activityFailed && <Failed>Commit activity couldn&apos;t load right now. Try refreshing this page.</Failed>}
      {v.spendKind === "unavailable" && v.pr && <Failed>{v.aiUnavailable}</Failed>}
      {v.aiModel && !v.withholdAllocatedRoi && (
        <Defer strategy="idle">
          <AiDeliveryModuleV2Chunk model={v.aiModel} slug={v.slug} />
        </Defer>
      )}
      {v.aiModel && v.withholdAllocatedRoi && (
        <Frame pad="sm">
          <Lede>{WITHHOLD}</Lede>
        </Frame>
      )}
      {v.pr && <DeliveryPrV2 pr={v.pr} />}
      {v.gov && <DeliveryGovV2 gov={v.gov} />}
      {v.activity && <DeliveryActivityV2 activity={v.activity} />}
    </div>
  );
}
