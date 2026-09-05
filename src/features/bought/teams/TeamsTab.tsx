// Org dashboard "Teams" tab — the fleet rolled up by CODEOWNERS team ownership. Migrated from
// src/app/org/[slug]/teams/page.tsx (docs/ORG-TABS-REFACTOR.md).
//
// SERVER component, filename PINNED as TeamsTab.tsx. No auth work here — the org layout's
// canReadOrg gate already ran. One Suspense boundary: the scope resolution, period window, team
// rollup and decision map are all needed together for this single panel, so splitting them into
// separate boundaries would only add complexity without letting anything paint sooner.

import { Suspense } from "react";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { TeamsRollupPanel } from "./TeamsRollupPanel";

export async function TeamsTab({ slug, sp }: { slug: string; sp: { [key: string]: string | string[] | undefined } }) {
  return (
    <div className="stagger-children space-y-6">
      <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
        <TeamsRollupPanel slug={slug} sp={sp} />
      </Suspense>
    </div>
  );
}
