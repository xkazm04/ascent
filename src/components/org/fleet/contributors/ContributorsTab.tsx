// Org dashboard "Contributors" tab — who's adopting AI, key-person risk, resilience. Migrated from
// src/app/org/[slug]/contributors/page.tsx (docs/ORG-TABS-REFACTOR.md).
//
// SERVER component, filename PINNED as ContributorsTab.tsx. No auth work — the org layout's
// canReadOrg gate already ran. One Suspense boundary: the scope, contributor insights and decision
// map are all needed together for this single panel.

import { Suspense } from "react";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { ContributorsInsightsPanel } from "./ContributorsInsightsPanel";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function ContributorsTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  return (
    <div className="stagger-children space-y-6">
      <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
        <ContributorsInsightsPanel slug={slug} sp={sp} />
      </Suspense>
    </div>
  );
}
