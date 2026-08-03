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

import { Suspense } from "react";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { OverviewFleetPanel } from "./OverviewFleetPanel";
import { OverviewScopeReadout } from "./OverviewScopeReadout";
import { resolveBillingReturn } from "./overviewBilling";
import { PersonalOverview } from "@/components/org/PersonalOverview";
import { BillingReturnNotice } from "@/components/org/shared/BillingReturnNotice";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { getOrgHeaderSummary } from "@/lib/db";
import { resolveOrgScope } from "@/lib/org/scope";
import { resolveOrgWindow } from "@/lib/org/period";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function OverviewTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  const billing = resolveBillingReturn(slug, sp);
  const billingNotice = billing ? <BillingReturnNotice status={billing.status} dismissHref={billing.dismissHref} /> : null;

  // A PERSONAL workspace renders the individual overview — the watchlist lens over the shared public
  // corpus — instead of the fleet rollup (whose reads would find nothing: a personal org holds
  // pointer rows, never scans). One cheap read, deduped per request with the layout's identical call
  // — the export is React-`cache()`d, so this really is free rather than a second round-trip.
  const headerSummary = await getOrgHeaderSummary(slug);
  if (headerSummary?.kind === "personal") {
    return (
      <div className="stagger-children space-y-6">
        {billingNotice}
        <PersonalOverview slug={slug} />
      </div>
    );
  }

  // An explicit ?range= wins (shareable links stay authoritative); otherwise the remembered period
  // cookie, then the default. Cookie-only — no database, so the period chrome never blocks.
  const period = await resolveOrgWindow(sp);
  const win = { start: period.start, end: period.end };

  // Segment + tech-stack scope still applies via deep links (?segment= / ?stack= carried from other
  // tabs); the in-view Type/Stack/Level dropdowns replace the old top-of-page selectors. Deliberately
  // NOT awaited here — see the note at the top of the file.
  const scope = resolveOrgScope(slug, sp);

  // `?dim=` — the in-page deep link the dimension grid's ▦ affordance emits. Read from the URL, not
  // from a query: it only seeds the heatmap's column sort. A bogus value is ignored downstream.
  const dimParam = typeof sp.dim === "string" ? sp.dim : undefined;

  // The tab's own query string, rebuilt from the resolved searchParams (a server component has no
  // useSearchParams). Threaded into the panels so their deep links compose off the CURRENT scope
  // rather than resetting it — the same rule buildUrl's docstring states for the client shell.
  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])),
  ).toString();

  return (
    <div className="stagger-children space-y-6">
      {billingNotice}

      {/* Period control + active-scope readout (filtering lives in the view's header dropdowns). */}
      <div data-tour="results-controls" className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
          Showing · {period.title}
          <Suspense fallback={null}>
            <OverviewScopeReadout scope={scope} />
          </Suspense>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <TimeRangeSelector range={period.key} from={period.from} to={period.to} />
        </div>
      </div>

      <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
        <OverviewFleetPanel slug={slug} scope={scope} win={win} periodTitle={period.title} sortDim={dimParam} search={search} />
      </Suspense>
    </div>
  );
}
