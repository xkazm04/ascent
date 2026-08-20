// Org dashboard "Tech Stacks" tab — the stack × dimension heat matrix and the dimension analysis
// board. Migrated from src/app/org/[slug]/tech-stacks/page.tsx (docs/ORG-TABS-REFACTOR.md).
//
// SERVER component, filename PINNED as TechStacksTab.tsx. No auth work here — the org layout's
// canReadOrg gate already ran.
//
// The A-vs-B "Compare stacks" panel that used to sit under the analysis was DELETED (2026-08-19),
// root and branch: TechStacksComparePanel / StackComparePanel / TechStackComparePicker, the
// `insightCompareHref` deep link into it, and its data read (`compareTechStacks` + `summarizeTechStack`
// in src/lib/db/tech-groups.ts, with their unit test). Everything it answered — which stack leads,
// which lags, by how much, on which dimension — the analysis board above it already answers for ALL
// stacks at once, per dimension, with a transformation playbook attached. Picking two stacks by hand
// was a strictly narrower read of the same numbers.

import { Suspense } from "react";
import Link from "next/link";
import { TechStacksAnalysisPanel } from "./TechStacksAnalysisPanel";
import { SectionEmpty, SectionHeader } from "@/components/org/shared/ui";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { listTechStackGroups } from "@/lib/db";
import { orgTabHref } from "@/lib/org/orgTabs";

export async function TechStacksTab({ slug }: { slug: string }) {
  const groups = await listTechStackGroups(slug);

  if (groups.length === 0) {
    return (
      <SectionEmpty>
        No tech stacks detected yet. Stacks are derived from each repo&apos;s manifests at scan time. Scan some of this org&apos;s{" "}
        <Link href={orgTabHref(slug, "repositories")} className="text-accent hover:text-white">repositories</Link>, then this view groups them by Frontend / Backend·language / Mobile / Data·ML / Infra.
      </SectionEmpty>
    );
  }

  return (
    <div className="stagger-children space-y-6">
      <div>
        <SectionHeader
          title="Tech stacks"
          description="Per-stack maturity across the fleet. Overlay stack profiles to compare their shape, then read the dimension analysis and transformation playbooks: the selection drives both."
        />
        <Suspense fallback={<OrgTabGap minH="min-h-[28rem]" />}>
          <TechStacksAnalysisPanel slug={slug} />
        </Suspense>
      </div>
    </div>
  );
}
