// Org dashboard "Governance" tab — the fleet maturity gate as policy-as-code. SERVER component,
// filename PINNED (docs/ORG-TABS-REFACTOR.md; see AuditTab.tsx for the worked example). Its old route
// (src/app/org/[slug]/governance/page.tsx) is now a redirect().
//
// Everything below derives from one `buildGovernanceOverview` read (see GovernancePanel), so the tab
// gets a single <Suspense> boundary rather than one per card — there is only one independent data
// source here.

import { Suspense } from "react";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { GovernancePanel } from "./GovernancePanel";

type SearchParams = { [key: string]: string | string[] | undefined };

export function GovernanceTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  return (
    <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
      <GovernancePanel slug={slug} sp={sp} />
    </Suspense>
  );
}
