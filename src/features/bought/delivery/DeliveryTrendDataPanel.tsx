// The Delivery tab's trend-over-time data region — its own <Suspense> boundary because
// getOrgDeliveryTrend is a genuinely separate (windowed) query from the PR/governance/activity/AI
// reads in DeliveryCorePanel, so a slow trend query can't hold the rest of the tab hostage.

import { Frame, Lede } from "@/components/kit";
import { DeliveryTrendV2 } from "./DeliveryTrend.v2";
import { getOrgDeliveryTrend } from "@/lib/db/org-delivery-trend";
import type { OrgScope } from "@/lib/org/scope";
import type { ResolvedWindow } from "@/lib/window";

const TREND_FAILED = "The delivery trend couldn't load right now. Try refreshing this page.";

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
    return <Frame pad="sm"><Lede>{TREND_FAILED}</Lede></Frame>;
  }
  if (!trend) return null;

  const view = { trend, range: period.key, from: period.from, to: period.to, periodTitle: period.title };
  return <DeliveryTrendV2 {...view} />;
}
