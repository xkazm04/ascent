// The Prism composition of the Tech Stacks tab: a masthead stating how many stacks the fleet runs over how
// many dimensions, then the analysis panel (its own Suspense boundary and read) drawn in Prism. The
// empty state is the same sentence as v1, set as plain prose.
import { Suspense } from "react";
import Link from "next/link";
import { Masthead } from "@/components/kit";
import { DIMS } from "@/components/shared/dashboard/ui";
import { OrgTabGap } from "@/components/shared/dashboard/OrgTabGap";
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { TechStacksAnalysisPanel } from "./TechStacksAnalysisPanel";

export function techStacksV2(slug: string, stackCount: number) {
  if (stackCount === 0) {
    return (
      <p className="max-w-[60ch] type-body text-slate-300">
        No tech stacks detected yet. Stacks are derived from each repo&apos;s manifests at scan time. Scan some of this org&apos;s{" "}
        <Link href={orgTabHref(slug, "repositories")} className="focus-ring text-accent hover:text-white">
          repositories
        </Link>
        , then this view groups them by Frontend / Backend·language / Mobile / Data·ML / Infra.
      </p>
    );
  }
  return (
    <div data-role="tech-stacks-v2" className="stagger-children space-y-8">
      <Masthead
        eyebrow="Tech stacks"
        statement={`${stackCount} stacks,`}
        named={`${DIMS.length} dimensions each.`}
        lede="How each stack scores on every dimension, where they agree and where one lags another."
      />
      <Suspense fallback={<OrgTabGap minH="min-h-[28rem]" />}>
        <TechStacksAnalysisPanel slug={slug} theme="prism" />
      </Suspense>
      <NextMoveLink href={orgTabHref(slug, "proposals")} to="proposals" />
    </div>
  );
}
