// The Adoption tab's one data region — moved from the old page.tsx body (docs/ORG-TABS-REFACTOR.md).
//
// /org redesign, Wave 2 (docs/ORG-UX-REDESIGN.md §2): the panel opens on the adoption CURVE, not on a
// paragraph and a row of tiles. The header's 213-character lede is gone — its definition half is a
// WhyChip, its contents list was the page's own structure, its CTA instruction sits on the CTA, and
// only the snapshot WINDOW survives in the description, which §2.3 permits at ≤60 characters.

import { buildAdoptionOverview, adoptionMarkdown } from "@/lib/org/adoption";
import { SectionEmpty } from "@/components/shared/dashboard/ui";
import { ScopeFilterBar } from "@/components/shared/scope/ScopeFilterBar";
import { resolveOrgScope } from "@/lib/org/scope";
import { adoptionView } from "./AdoptionOverview";
import type { AdoptionViewProps } from "./adoptionViewProps";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function AdoptionOverviewPanel({ slug, sp }: { slug: string; sp: SearchParams }) {
  // Optional segment + tech-stack scope (bogus id/key → whole fleet) — a per-client / per-stack
  // adoption read for orgs that segment their fleet; the two filters compose.
  const { segments, segmentId, techGroups, activeStack, techGroupId } = await resolveOrgScope(slug, sp);
  const a = await buildAdoptionOverview(slug, segmentId, techGroupId);

  const filterBar = (
    <ScopeFilterBar segments={segments} segmentId={segmentId} techGroups={techGroups} activeStack={activeStack} />
  );

  if (!a) {
    return (
      <div>
        <div className="mb-4 flex justify-end">{filterBar}</div>
        <SectionEmpty>
          No contributor data {segmentId || activeStack ? "for this filter" : "yet"}: scan some of this org&apos;s repositories (with a
          GitHub token for commit history) to measure AI adoption. Adoption here is read from commits and PRs — co-authorship trailers and
          tool markers — so a fleet scanned without commit history has an org-wide picture but no adoption curve to draw.
        </SectionEmpty>
      </div>
    );
  }

  const md = adoptionMarkdown(a);
  const props: AdoptionViewProps = { a, slug, filterBar, md };
  return adoptionView(props);
}
