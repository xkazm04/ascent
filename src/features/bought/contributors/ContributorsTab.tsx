// Org dashboard "Contributors" tab — who's adopting AI, key-person risk, resilience. Migrated from
// src/app/org/[slug]/contributors/page.tsx (docs/ORG-TABS-REFACTOR.md).
//
// SERVER component, filename PINNED as ContributorsTab.tsx. No auth work — the org layout's
// canReadOrg gate already ran. One Suspense boundary: the scope, contributor insights and decision
// map are all needed together for this single panel.

import { Suspense } from "react";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { ContributorsInsightsPanel } from "./ContributorsInsightsPanel";
import { ContributorsCareSection } from "./ContributorsCareSection";
import { resolveViewerLogin } from "@/lib/access";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function ContributorsTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  // Resolved HERE, in the server tab body, and threaded down: the "You" pointer (§5.2) needs to know
  // whether the viewer is in the roster, and a cookie-scoped read must not happen inside a streamed
  // boundary (memory: getviewer-not-in-sse-start).
  const viewerLogin = await resolveViewerLogin();
  return (
    <div className="stagger-children space-y-6">
      <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
        <ContributorsInsightsPanel slug={slug} sp={sp} viewerLogin={viewerLogin} />
      </Suspense>
      {/* The former Care tab's ORG mode, folded in below the git-side modules (§5.2). Its own
          Suspense boundary so the aggregate never delays the tab's main read. */}
      <Suspense fallback={null}>
        <ContributorsCareSection slug={slug} />
      </Suspense>
    </div>
  );
}
