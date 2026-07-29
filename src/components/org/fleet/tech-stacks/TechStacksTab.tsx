// Org dashboard "Tech Stacks" tab — the stack × dimension heat matrix plus the A-vs-B comparison
// panel. Migrated from src/app/org/[slug]/tech-stacks/page.tsx (docs/ORG-TABS-REFACTOR.md).
//
// SERVER component, filename PINNED as TechStacksTab.tsx. No auth work here — the org layout's
// canReadOrg gate already ran. Two independent reads (the analysis matrix, the A/B comparison) each
// get their own <Suspense> so a slow comparison query can't hold the matrix, and vice versa.

import { Suspense } from "react";
import Link from "next/link";
import { TechStacksAnalysisPanel } from "./TechStacksAnalysisPanel";
import { TechStacksComparePanel } from "./TechStacksComparePanel";
import { SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { listTechStackGroups } from "@/lib/db";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { OrgSearchParams } from "@/components/org/shell/OrgTabChunks";

export async function TechStacksTab({ slug, sp }: { slug: string; sp: OrgSearchParams }) {
  const groups = await listTechStackGroups(slug);

  if (groups.length === 0) {
    return (
      <SectionEmpty>
        No tech stacks detected yet. Stacks are derived from each repo&apos;s manifests at scan time — scan some of this org&apos;s{" "}
        <Link href={orgTabHref(slug, "repositories")} className="text-accent hover:text-white">repositories</Link>, then this view groups them by Frontend / Backend·language / Mobile / Data·ML / Infra.
      </SectionEmpty>
    );
  }

  return (
    <div className="stagger-children space-y-6">
      <div>
        <SectionHeader
          title="Tech stacks"
          description="Per-stack maturity across the fleet. Overlay stack profiles to compare their shape, then read the dimension analysis and transformation playbooks — the selection drives both."
        />
        <Suspense fallback={<OrgTabGap minH="min-h-[28rem]" />}>
          <TechStacksAnalysisPanel slug={slug} />
        </Suspense>
      </div>

      <div id="compare">
        <Suspense fallback={<OrgTabGap minH="min-h-[20rem]" />}>
          <TechStacksComparePanel slug={slug} groups={groups} sp={sp} />
        </Suspense>
      </div>
    </div>
  );
}
