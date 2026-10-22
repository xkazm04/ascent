// Org dashboard "Overview" tab — the fleet rollup, and the dashboard's default landing surface.
//
// REFERENCE IMPLEMENTATION (docs/ORG-TABS-REFACTOR.md). This is the fuller of the two worked
// examples; copy this one when a tab has real data and more than one data source:
//   - SERVER component. The shell is client-side (instant pill highlight); the panels are not, so
//     they keep reading the database directly behind the layout's canReadOrg gate. Never convert a
//     tab to "use client" to make it fit the shell.
//   - Filename PINNED as `<Feature>Tab.tsx`; it takes `slug` + the resolved `sp` as props, because
//     it is no longer a route and cannot await route params itself.
//   - Tier 1 (chrome: the scope line + period control) renders on the FIRST frame — nothing above it
//     awaits a query. Tier 2 (the two data regions) each sit in their own <Suspense> so the slow
//     rollup cannot hold the cheap scope readout, and vice versa.
//   - `resolveOrgScope` is called ONCE and the PROMISE is handed to both regions. Awaiting the same
//     promise in two boundaries costs one query and lets them stream independently — calling the
//     helper twice would silently double the fleet's segment/stack lookups.
//   - `stagger-children` on the wrapper cascades the direct children in. Do NOT also put
//     `.animate-arrive-in` on a direct child — the cascade already animates it.
//   - No skeletons anywhere: a waiting region is an empty reserved-height <OrgTabGap>.

import { OverviewTabV2 } from "./OverviewTab.v2";
import { resolveBillingReturn } from "./overviewBilling";
import { resolveOverviewInputs, type OverviewSearchParams } from "./overviewInputs";
import { PersonalOverview } from "@/components/org/personal/PersonalOverview";
import { BillingReturnNotice } from "@/components/shared/credits/BillingReturnNotice";
import { getOrgHeaderSummary } from "@/lib/db";

export async function OverviewTab({ slug, sp }: { slug: string; sp: OverviewSearchParams }) {
  const billing = resolveBillingReturn(slug, sp);
  const billingNotice = billing ? (
    <BillingReturnNotice status={billing.status} org={slug} checkoutId={billing.checkoutId} dismissHref={billing.dismissHref} />
  ) : null;

  // A PERSONAL workspace renders the individual overview (the watchlist lens over the shared public corpus)
  // instead of the fleet rollup, whose reads would find nothing. One cheap read, deduped per request with
  // the layout's identical call (the export is React-`cache()`d).
  const headerSummary = await getOrgHeaderSummary(slug);
  if (headerSummary?.kind === "personal") {
    return (
      <div className="stagger-children space-y-6">
        {billingNotice}
        <PersonalOverview slug={slug} />
      </div>
    );
  }

  const inputs = await resolveOverviewInputs(slug, sp);
  return <OverviewTabV2 slug={slug} billingNotice={billingNotice} i={inputs} />;
}
