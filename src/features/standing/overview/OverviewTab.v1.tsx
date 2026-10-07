// The Altimeter composition of the Overview tab (the shipped look), moved here unchanged from OverviewTab.tsx.
// The entry resolves the inputs once and picks this or OverviewTab.v2.tsx by theme; see the entry's header
// for the tab's server/streaming rules, which both compositions follow.
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Toolbar, ToolbarReadout } from "@/components/kit";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { OverviewFixFirstGap, OverviewFixFirstPanel } from "./OverviewFixFirstPanel";
import { OverviewFleetPanel } from "./OverviewFleetPanel";
import { OverviewScopeReadout } from "./OverviewScopeReadout";
import type { OverviewInputs } from "./overviewInputs";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { orgTabHref } from "@/lib/org/orgTabs";

export function OverviewTabV1({ slug, billingNotice, i }: { slug: string; billingNotice: ReactNode; i: OverviewInputs }) {
  const { period, win, scope } = i;
  return (
    <div className="stagger-children space-y-6">
      {billingNotice}

      {/* Period control + active-scope readout (filtering lives in the view's header dropdowns). */}
      <Toolbar
        data-tour="results-controls"
        left={
          <ToolbarReadout>
            Showing · {period.title}
            <Suspense fallback={null}>
              <OverviewScopeReadout scope={scope} />
            </Suspense>
          </ToolbarReadout>
        }
        right={<TimeRangeSelector range={period.key} from={period.from} to={period.to} />}
      />
      {/* Caption-only: Overview's Type/Stack/Level filters live in the view headers, but this is
          still the rollup+movers surface, so the bar discloses the in-period split when `win.start`
          is set (all-time renders nothing). */}
      <ScopeFilterBar segments={[]} segmentId={null} techGroups={[]} activeStack={null} window={win} />

      {/* "Fix first" punch-list: its own boundary so its reads stream independently and can never hold
          the fleet panel. Falls back to a reserved-height gap, not null: a pending band must not read
          as "no priorities." Empty (deriveFixFirst = []) still collapses. */}
      <Suspense fallback={<OverviewFixFirstGap />}>
        <OverviewFixFirstPanel slug={slug} win={win} scopeQuery={i.stackQuery} />
      </Suspense>

      <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
        <OverviewFleetPanel
          slug={slug}
          scope={scope}
          win={win}
          periodTitle={period.title}
          comparisonLabel={period.comparisonLabel}
          sortDim={i.dimParam}
          search={i.search}
        />
      </Suspense>

      <NextMoveLink href={orgTabHref(slug, "proposals")} to="proposals" />
    </div>
  );
}
