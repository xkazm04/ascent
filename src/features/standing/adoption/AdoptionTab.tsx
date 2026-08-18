// Org dashboard "Adoption" tab — AI-adoption intelligence: how much of the org's work is AI-assisted,
// the champions, the teams carrying (or missing) the habits, who to enable next, and the delivery
// health it sits alongside. Migrated from src/app/org/[slug]/adoption/page.tsx
// (docs/ORG-TABS-REFACTOR.md).
//
// SERVER component, filename PINNED as AdoptionTab.tsx. No auth work — the org layout's canReadOrg
// gate already ran. One Suspense boundary: the scope + adoption overview are needed together for
// this single panel (every section below reads off the one `buildAdoptionOverview` result).

import { Suspense } from "react";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { AdoptionOverviewPanel } from "./AdoptionOverviewPanel";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function AdoptionTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  return (
    <div className="stagger-children space-y-6">
      <Suspense fallback={<OrgTabGap minH="min-h-[40rem]" />}>
        <AdoptionOverviewPanel slug={slug} sp={sp} />
      </Suspense>
    </div>
  );
}
