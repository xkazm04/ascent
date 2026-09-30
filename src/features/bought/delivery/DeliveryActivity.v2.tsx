// Commit activity in Prism. The chart stays: the kit Trend cannot draw a count axis or a
// broken week. The caption pluralizes weeks the same way the Altimeter composition does.
import { Frame, SectionHead } from "@/components/kit";
import { Defer } from "@/components/ui/Defer";
import { WhyChip } from "@/components/org/viz";
import type { OrgActivity } from "@/lib/db";
import { DeliveryActivityChartChunk } from "./DeliveryTabChunks";

const HINT =
  "Weekly commit counts read from GitHub itself, not derived from a scan's aggregates, only the repositories that reported activity in the window contribute.";

export function DeliveryActivityV2({ activity }: { activity: OrgActivity }) {
  const caption = `${activity.total.toLocaleString()} commits · ${activity.weeks} week${activity.weeks === 1 ? "" : "s"} · ${activity.repos} repo${activity.repos === 1 ? "" : "s"}`;
  return (
    <Frame>
      <SectionHead
        eyebrow="Activity"
        title="Commit activity"
        named={caption}
        lede={<WhyChip hint={HINT} label="where commit activity comes from" />}
      />
      <Defer strategy="visible" placeholder={<div className="reveal-quiet min-h-[16rem]" aria-hidden />}>
        <div className="mt-6">
          <DeliveryActivityChartChunk series={activity.series} endWeekStartMs={activity.endWeekStartMs} />
        </div>
      </Defer>
    </Frame>
  );
}
