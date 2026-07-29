// The Delivery tab's trend-over-time data region — its own <Suspense> boundary because
// getOrgDeliveryTrend is a genuinely separate (windowed) query from the PR/governance/activity/AI
// reads in DeliveryCorePanel, so a slow trend query can't hold the rest of the tab hostage.

import { SectionEmpty } from "@/components/org/shared/ui";
import { DeliveryTrendSection } from "./DeliveryTrendSection";
import { getOrgDeliveryTrend } from "@/lib/db/org-delivery-trend";
import type { OrgScope } from "@/lib/org/scope";
import type { ResolvedWindow } from "@/lib/window";

export async function DeliveryTrendDataPanel({
  slug,
  scope,
  period,
}: {
  slug: string;
  /** The SHARED scope promise created once in DeliveryTab and awaited in both boundaries. */
  scope: Promise<OrgScope>;
  period: ResolvedWindow;
}) {
  const { segmentId, techGroupId } = await scope;

  // G4-10: this query now lives in its OWN Suspense boundary (split out of the tab's old single
  // allSettled), so a throw here must be caught locally — otherwise it would bubble to the tab's
  // error boundary and blank the whole Delivery tab over one degraded panel.
  let trend;
  try {
    trend = await getOrgDeliveryTrend(slug, period, segmentId, techGroupId);
  } catch (err) {
    console.error(`[delivery/${slug}] getOrgDeliveryTrend failed:`, err);
    return <SectionEmpty>The delivery trend couldn&apos;t load right now — try refreshing this page.</SectionEmpty>;
  }
  if (!trend) return null;

  return (
    <DeliveryTrendSection trend={trend} range={period.key} from={period.from} to={period.to} periodTitle={period.title} />
  );
}
