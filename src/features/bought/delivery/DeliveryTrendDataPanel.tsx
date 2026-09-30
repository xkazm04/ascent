// The Delivery tab's trend-over-time data region — its own <Suspense> boundary because
// getOrgDeliveryTrend is a genuinely separate (windowed) query from the PR/governance/activity/AI
// reads in DeliveryCorePanel, so a slow trend query can't hold the rest of the tab hostage.

import { SectionEmpty } from "@/components/org/shared/ui";
import { Frame, Lede } from "@/components/kit";
import { DeliveryTrendSection } from "./DeliveryTrendSection";
import { DeliveryTrendV2 } from "./DeliveryTrend.v2";
import { getOrgDeliveryTrend } from "@/lib/db/org-delivery-trend";
import type { OrgScope } from "@/lib/org/scope";
import type { ResolvedWindow } from "@/lib/window";
import type { ThemeId } from "@/lib/theme/theme";

const TREND_FAILED = "The delivery trend couldn't load right now. Try refreshing this page.";

export async function DeliveryTrendDataPanel({
  slug,
  scope,
  period,
  theme = "altimeter",
}: {
  slug: string;
  /** The SHARED scope promise created once in DeliveryTab and awaited in both boundaries. */
  scope: Promise<OrgScope>;
  period: ResolvedWindow;
  theme?: ThemeId;
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
    return theme === "prism" ? (
      <Frame pad="sm"><Lede>{TREND_FAILED}</Lede></Frame>
    ) : (
      <SectionEmpty>{TREND_FAILED}</SectionEmpty>
    );
  }
  if (!trend) return null;

  const view = { trend, range: period.key, from: period.from, to: period.to, periodTitle: period.title };
  return theme === "prism" ? <DeliveryTrendV2 {...view} /> : <DeliveryTrendSection {...view} />;
}
