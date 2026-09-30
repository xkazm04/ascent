// Altimeter body of the core region. Markup moved unchanged from DeliveryCorePanel.
import { Card, SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { SnapshotScopeNotice } from "@/components/org/shared/SnapshotScopeNotice";
import { Defer } from "@/components/ui/Defer";
import { WhyChip } from "@/components/org/viz";
import { DeliveryPriorities } from "./DeliveryPriorities";
import { DeliveryPrSection } from "./DeliveryPrSection";
import { DeliveryGovernanceSection } from "./DeliveryGovernanceSection";
import { AiDeliveryModuleChunk, DeliveryActivityChartChunk } from "./DeliveryTabChunks";
import { deliveryEmptyMessage } from "./deliveryLoad";
import type { DeliveryCoreViewProps } from "./deliveryCoreView";

export function DeliveryCoreV1({
  slug,
  period,
  segmentBar,
  segmentId,
  techGroupId,
  pr,
  gov,
  activity,
  prFailed,
  govFailed,
  activityFailed,
  spendKind,
  aiModel,
  withholdAllocatedRoi,
  aiUnavailable,
}: DeliveryCoreViewProps) {
  if (!pr && !gov && !activity) {
    const anyFailed = prFailed || govFailed || activityFailed;
    return (
      <div className="space-y-4">
        {segmentBar}
        <SectionEmpty>{deliveryEmptyMessage({ anyFailed, segmentId, techGroupId })}</SectionEmpty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {segmentBar}

      <SnapshotScopeNotice
        period={period}
        subject="delivery"
        scope="partial"
        detail={
          <>
            The <span className="text-slate-200">trend</span>, unit economics, outcomes and AI spend are period-scoped.
            Pull request signals, branch governance and commit activity below this line are a{" "}
            <span className="text-slate-200">scan-time snapshot</span>.{" "}
            <WhyChip
              hint="Pull request signals, branch governance and commit activity are read off each repo's most recent scan. Scan.prStats is a pre-computed aggregate with no dated PR population to re-cut, so no range can re-scope it — read these as 'the fleet as of its most recent scans'."
              label="why this half is not period-scoped"
            />
          </>
        }
      />

      {(pr || gov) && <DeliveryPriorities pr={pr} gov={gov} />}

      {prFailed && <SectionEmpty>Pull request signals couldn&apos;t load right now. Try refreshing this page.</SectionEmpty>}
      {govFailed && <SectionEmpty>Branch governance couldn&apos;t load right now. Try refreshing this page.</SectionEmpty>}
      {activityFailed && <SectionEmpty>Commit activity couldn&apos;t load right now. Try refreshing this page.</SectionEmpty>}
      {spendKind === "unavailable" && pr && <SectionEmpty>{aiUnavailable}</SectionEmpty>}

      {aiModel && !withholdAllocatedRoi && (
        <Defer strategy="idle">
          <AiDeliveryModuleChunk model={aiModel} slug={slug} />
        </Defer>
      )}
      {aiModel && withholdAllocatedRoi && (
        <SectionEmpty>
          AI spend for this org is connected only as a whole-org total (allocated), which has no per-repo
          breakdown, so splitting it across a filtered segment/stack would inflate the dollar figures. Clear
          the filter to see AI delivery ROI, or connect per-repo telemetry for filterable spend.
        </SectionEmpty>
      )}

      {pr && <DeliveryPrSection pr={pr} />}

      {gov && <DeliveryGovernanceSection gov={gov} />}

      {activity && (
        <Defer strategy="visible" placeholder={<div className="reveal-quiet min-h-[16rem]" aria-hidden />}>
          <Card>
            <SectionHeader
              size="sm"
              title={
                <span className="inline-flex items-center gap-2">
                  Commit activity
                  <WhyChip
                    hint="Weekly commit counts read from GitHub itself, not derived from a scan's aggregates — only the repositories that reported activity in the window contribute."
                    label="where commit activity comes from"
                  />
                </span>
              }
              description={`${activity.total.toLocaleString()} commits · ${activity.weeks} week${activity.weeks === 1 ? "" : "s"} · ${activity.repos} repo${activity.repos === 1 ? "" : "s"}`}
            />
            <div className="mt-4">
              <DeliveryActivityChartChunk series={activity.series} endWeekStartMs={activity.endWeekStartMs} />
            </div>
          </Card>
        </Defer>
      )}
    </div>
  );
}
