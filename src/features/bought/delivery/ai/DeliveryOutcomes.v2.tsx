// Prism delivery outcomes. No deployments is an onboarding frame. The DORA instrument stays.
import { Caption, Frame, Lede, SectionHead } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { DeliveryOutcomes as Outcomes } from "@/lib/db/delivery-outcomes";
import { DeliveryOutcomesTableV2 } from "./DeliveryOutcomesTable.v2";
import { DoraSmallMultiple } from "./DoraSmallMultiple";
import { FailureSplitMark } from "./FailureSplitMark";
import { doraPanels } from "./doraPanels";

export function DeliveryOutcomesV2({ slug, outcomes, periodTitle }: { slug: string; outcomes: Outcomes; periodTitle: string }) {
  const period = periodTitle.toLowerCase();
  if (outcomes.total === 0) {
    return (
      <Frame>
        <SectionHead eyebrow="Outcomes" title="Delivery outcomes" named="need a deployment." lede={periodTitle} />
        <Lede className="mt-3">
          Deployment frequency, change-failure rate, and the number worth having: whether AI-attributed changes fail
          more often than human-authored ones. All three read the GitHub Deployments API during a scan, and no
          deployments were recorded in {period}. A repository that deploys another way (or whose scan ran without a
          token) contributes nothing here.{" "}
          <a href={orgTabHref(slug, "repositories")} className="focus-ring text-slate-200 underline hover:text-white">
            Re-scan the fleet
          </a>{" "}
          after deployments exist and this fills in.
        </Lede>
      </Frame>
    );
  }
  const panels = doraPanels(outcomes);
  const anyVoid = panels.some((p) => p.state === "missing") || outcomes.ai.failureRate == null || outcomes.human.failureRate == null;
  const envs = `${outcomes.environments.length} env`;
  return (
    <Frame>
      <SectionHead
        eyebrow="Outcomes"
        title="Delivery outcomes"
        named={`${outcomes.total.toLocaleString()} deployments`}
        lede={`${envs} · ${periodTitle}`}
      />
      <div className="mt-6">
        <DoraSmallMultiple panels={panels} />
      </div>
      <div className="mt-6">
        <FailureSplitMark ai={outcomes.ai} human={outcomes.human} gap={outcomes.failureRateGap} periodTitle={periodTitle} />
      </div>
      {anyVoid && <Caption className="mt-3">A missing rate is below the sample floor, not a zero.</Caption>}
      <div className="mt-6">
        <DeliveryOutcomesTableV2 ai={outcomes.ai} human={outcomes.human} />
      </div>
    </Frame>
  );
}
