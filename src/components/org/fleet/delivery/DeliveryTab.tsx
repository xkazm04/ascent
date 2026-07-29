// Org dashboard "Delivery" tab — PR signals, branch governance, commit activity and the AI delivery
// ROI/governance read. Migrated from src/app/org/[slug]/delivery/page.tsx (docs/ORG-TABS-REFACTOR.md).
//
// SERVER component, filename PINNED as DeliveryTab.tsx. No auth work — the org layout's canReadOrg
// gate already ran. `resolveOrgScope` + `resolveOrgWindow` are each called ONCE and the promises
// handed to both regions below (the OverviewTab pattern) — awaiting a promise twice does not re-run
// the query. Two Suspense boundaries: the trend (its own windowed query, genuinely independent) and
// the core panel (PR/governance/activity/AI — interdependent enough, via DeliveryPriorities and the
// AI ROI model, that splitting them further would duplicate reads rather than parallelize them).

import { Suspense } from "react";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { resolveOrgScope } from "@/lib/org/scope";
import { resolveOrgWindow } from "@/lib/org/period";
import { DeliveryTrendDataPanel } from "./DeliveryTrendDataPanel";
import { DeliveryCorePanel } from "./DeliveryCorePanel";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function DeliveryTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  // Optional segment + tech-stack scope (bogus id/key → whole fleet) so a leader can read
  // delivery/governance for one business unit or stack; the two filters compose. Deliberately NOT
  // awaited here — see the note at the top of the file.
  const scope = resolveOrgScope(slug, sp);
  // G7-09: the trend needs a period. Resolved through the SHARED org-window helper (URL `?range=`,
  // then the remembered-period cookie, then the default) so picking "30 days" on the Overview carries
  // into Delivery instead of each tab inventing its own range.
  const period = await resolveOrgWindow(sp);

  return (
    <div className="stagger-children space-y-6">
      {/* G7-09: the only WINDOWED read on this tab — every other panel reads each repo's latest scan. */}
      <Suspense fallback={<OrgTabGap minH="min-h-[20rem]" />}>
        <DeliveryTrendDataPanel slug={slug} scope={scope} period={period} />
      </Suspense>

      <Suspense fallback={<OrgTabGap minH="min-h-[40rem]" />}>
        <DeliveryCorePanel slug={slug} scope={scope} />
      </Suspense>
    </div>
  );
}
