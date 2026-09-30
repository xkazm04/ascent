// The Delivery tab's core data region — PR signals, branch governance, commit activity and the AI
// delivery ROI/governance read. One Promise.allSettled (G4-10: a failing query degrades only its own
// section, never the tab). The theme picks DeliveryCore.v1 (Altimeter) or DeliveryCore.v2 (Prism);
// both receive this same resolved view.

import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { ExportCsvLink } from "@/components/org/shared/ui";
import { buildAiDeliveryModel } from "./ai/aiDeliveryModel";
import { getOrgActivity, getOrgGovernance, getOrgPrSignals, getOrgUsageRollup } from "@/lib/db";
import { aiRoiSpendKind, aiRoiUnavailableMessage, settle } from "./deliveryLoad";
import type { OrgScope } from "@/lib/org/scope";
import type { ResolvedWindow } from "@/lib/window";
import type { ThemeId } from "@/lib/theme/theme";
import { DeliveryCoreV1 } from "./DeliveryCore.v1";
import { DeliveryCoreV2 } from "./DeliveryCore.v2";

export async function DeliveryCorePanel({
  slug,
  scope,
  // Passed down from DeliveryTab (which already resolved it for the trend) rather than re-resolved
  // here: this panel has no `sp`, so a local resolve would silently drop an explicit `?range=` and
  // name the cookie's period on a shared link. The usage rollup takes the same `{start,end}` as
  // unit/outcomes so 30d/90d spend bounds match; PR/governance/activity stay latest-scan snapshots.
  period,
  theme = "altimeter",
}: {
  slug: string;
  scope: Promise<OrgScope>;
  period: ResolvedWindow;
  theme?: ThemeId;
}) {
  const { barProps, segmentId, techGroupId, activeStack } = await scope;

  // G4-10: Promise.all rejects on the FIRST failing query, which discarded all four panels — a
  // transient DB blip on, say, the governance rollup used to blank the whole page, including the PR
  // signals and activity chart that would have rendered fine. Promise.allSettled isolates each query so
  // one failure degrades only its own panel. Each panel then gets an explicit "couldn't load" banner
  // below (never a silent empty state) — an empty state reads as "nothing to show," which is a
  // different, false claim when the real story is "the query errored."
  const [prSettled, govSettled, activitySettled, usageSettled] = await Promise.allSettled([
    getOrgPrSignals(slug, segmentId, techGroupId),
    getOrgGovernance(slug, segmentId, techGroupId),
    getOrgActivity(slug, segmentId, techGroupId),
    // Finding A: getOrgUsageRollup is WHOLE-ORG and takes no scope arg. Its measured layer is per-repo
    // (so buildAiDeliveryModel's per-repo lookups already honor the filtered set), but its ALLOCATED
    // layer is a single org-level total with no per-repo breakdown — it genuinely cannot be filtered.
    getOrgUsageRollup(slug, { start: period.start, end: period.end }),
  ]);
  const { value: pr, failed: prFailed } = settle(prSettled);
  const { value: gov, failed: govFailed } = settle(govSettled);
  const { value: activity, failed: activityFailed } = settle(activitySettled);
  const { value: usage, failed: usageFailed } = settle(usageSettled);
  for (const [label, r] of [
    ["getOrgPrSignals", prSettled],
    ["getOrgGovernance", govSettled],
    ["getOrgActivity", activitySettled],
    ["getOrgUsageRollup", usageSettled],
  ] as const) {
    if (r.status === "rejected") console.error(`[delivery/${slug}] ${label} failed:`, r.reason);
  }

  // Query failure ≠ no cost source: a rejected usage rollup must not be passed to
  // buildAiDeliveryModel as `null` (that is the "none"/no-cost-source input). Withhold the model
  // and let the panel name the load as unavailable.
  const spendKind = aiRoiSpendKind(usage, usageFailed);
  const aiUnavailable = aiRoiUnavailableMessage();
  const aiModel = spendKind === "unavailable" ? null : buildAiDeliveryModel(pr, usage);

  // Finding A (money misattribution): in "allocated" fidelity buildAiDeliveryModel distributes the
  // WHOLE-ORG spend total across only the repos in `pr` (the filtered set) — weightSum shrinks with the
  // filter while the org-total numerator does not, so every $ readout inflates by (org total)/(filtered
  // subset) under a segment or stack filter. The org total has no per-repo breakdown, so withhold the
  // allocated-$ module under a filter. (measured is per-repo and stays filterable; no cost source is
  // locked empty cells, not a placeholder dollar.)
  const scoped = segmentId != null || techGroupId != null;
  const withholdAllocatedRoi = aiModel?.fidelity === "allocated" && scoped;

  const segmentBar = (
    <ScopeFilterBar {...barProps} className="flex flex-wrap items-center justify-end gap-2" gate={false}>
      <ExportCsvLink org={slug} kind="delivery" segmentId={segmentId} stack={activeStack?.key} />
    </ScopeFilterBar>
  );

  const view = {
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
  };
  return theme === "prism" ? <DeliveryCoreV2 {...view} /> : <DeliveryCoreV1 {...view} />;
}
