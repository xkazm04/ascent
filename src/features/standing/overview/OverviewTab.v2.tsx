// The Prism (v2) composition of the Overview tab. Same inputs, same streaming rules as v1; what changes is the
// ORDER: the standing masthead leads (it is the one dominant element) and "Fix first" is handed to the data
// region as a slot, so it sits directly under the masthead while keeping its own Suspense boundary. Tier 1
// chrome (period control + scope readout) still paints on the first frame, above everything that awaits.
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Toolbar, ToolbarReadout } from "@/components/kit";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { OverviewFixFirstGap, OverviewFixFirstPanel } from "./OverviewFixFirstPanel";
import { OverviewFleetPanel } from "./OverviewFleetPanel";
import { OverviewScopeReadout } from "./OverviewScopeReadout";
import type { OverviewInputs } from "./overviewInputs";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";

export function OverviewTabV2({ slug, billingNotice, i }: { slug: string; billingNotice: ReactNode; i: OverviewInputs }) {
  const { period, win, scope } = i;
  return (
    <div className="stagger-children space-y-8">
      {billingNotice}
      <Toolbar
        data-tour="results-controls"
        left={
          <ToolbarReadout>
            Period · {period.title}
            <Suspense fallback={null}>
              <OverviewScopeReadout scope={scope} />
            </Suspense>
          </ToolbarReadout>
        }
        right={<TimeRangeSelector range={period.key} from={period.from} to={period.to} />}
      />
      <ScopeFilterBar segments={[]} segmentId={null} techGroups={[]} activeStack={null} window={win} />
      <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
        <OverviewFleetPanel
          slug={slug}
          scope={scope}
          win={win}
          periodTitle={period.title}
          comparisonLabel={period.comparisonLabel}
          sortDim={i.dimParam}
          search={i.search}
          theme="prism"
          fixFirst={
            <Suspense fallback={<OverviewFixFirstGap />}>
              <OverviewFixFirstPanel slug={slug} win={win} scopeQuery={i.stackQuery} />
            </Suspense>
          }
        />
      </Suspense>
    </div>
  );
}
