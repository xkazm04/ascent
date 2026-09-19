// Delivery outcomes (W4) — the DORA read, and the number this wave exists for: do AI-attributed
// changes fail more than human-authored ones?
//
// That sentence is the most quotable thing this product can produce, which is exactly why the panel
// used to spend more space on its limits than on its headline — four of them, rendered as two
// paragraphs under two tables. Every one survives, and every one is now carried by the drawing or by
// a chip on the drawing (docs/ORG-UX-REDESIGN.md §2):
//
//   1. "FAILURE" MEANS THE DEPLOYMENT FAILED, not "caused an incident" → the change-failure panel's
//      WhyChip (D).
//   2. ATTRIBUTION COVERAGE IS PRINTED — it is one of the four panels, on the same 0–100 axis as the
//      failure rate, so how much the split is worth is read beside the split itself (E).
//   3. THE HUMAN BUCKET IS A RESIDUAL, contaminated in AI's favour → `RESIDUAL_HINT` on the paired
//      mark (D), reachable from the comparison rather than from a paragraph below it.
//   4. NO RATE UNDER THE SAMPLE FLOOR → a void track with an em dash. There is no bar to misread as
//      a 100%-out-of-one failure rate (E).
//
// Server-safe — no hooks, no handlers.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { Legend } from "@/components/org/viz";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { DeliveryOutcomes as Outcomes } from "@/lib/db/delivery-outcomes";
import { DoraSmallMultiple } from "./DoraSmallMultiple";
import { DeliveryOutcomesTable } from "./DeliveryOutcomesTable";
import { FailureSplitMark } from "./FailureSplitMark";
import { doraPanels } from "./doraPanels";

export function DeliveryOutcomes({ slug, outcomes, periodTitle }: { slug: string; outcomes: Outcomes; periodTitle: string }) {
  // No deployments is an honest state with an actionable cause, not an error and not a zero — and it
  // is the (O) Onboarding destination for the argument the panel makes when it has data.
  if (outcomes.total === 0) {
    return (
      <Card>
        <SectionHeader size="sm" title="Delivery outcomes" description={periodTitle} />
        <p className="mt-3 type-body-sm text-slate-400">
          Deployment frequency, change-failure rate and — the number worth having — whether AI-attributed changes fail
          more often than human-authored ones. All three read the GitHub Deployments API during a scan, and no
          deployments were recorded in {periodTitle.toLowerCase()}. A repository that deploys another way (or whose
          scan ran without a token) contributes nothing here.{" "}
          <a href={orgTabHref(slug, "repositories")} className="focus-ring text-accent hover:text-white">
            Re-scan the fleet
          </a>{" "}
          after deployments exist and this fills in.
        </p>
      </Card>
    );
  }

  const panels = doraPanels(outcomes);
  const anyVoid = panels.some((p) => p.state === "missing") || outcomes.ai.failureRate == null || outcomes.human.failureRate == null;

  return (
    <Card>
      {/* §2.3 — unit and window only. */}
      <SectionHeader
        size="sm"
        title="Delivery outcomes"
        description={`${outcomes.total.toLocaleString()} deployments · ${outcomes.environments.length} env · ${periodTitle}`}
      />

      {/* §2.2 — first sight is the four-panel instrument. */}
      <div className="mt-4">
        <DoraSmallMultiple panels={panels} />
      </div>

      <div className="mt-5">
        <FailureSplitMark ai={outcomes.ai} human={outcomes.human} gap={outcomes.failureRateGap} periodTitle={periodTitle} />
      </div>

      <Legend className="mt-3" states={anyVoid ? ["measured", "missing"] : ["measured"]} />

      <div className="mt-4">
        <DeliveryOutcomesTable ai={outcomes.ai} human={outcomes.human} />
      </div>
    </Card>
  );
}
