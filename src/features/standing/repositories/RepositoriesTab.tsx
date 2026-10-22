// Org dashboard "Repositories" tab — the fleet leaderboard, plus its "Segments" sub-view. Migrated
// from src/app/org/[slug]/repositories/page.tsx (docs/ORG-TABS-REFACTOR.md).
//
// SERVER component, filename PINNED as RepositoriesTab.tsx. No auth work — the org layout's
// canReadOrg gate already ran.
//
// `segments` is a top-level OrgTabId deliberately absent from the nav groups: `?tab=segments` renders
// THIS component in segments mode rather than a separate tab. OrgTabChunks' switch reads the RAW
// (pre-normalization) tab id and passes `mode` explicitly — this component never re-derives it from
// `sp.tab` itself, so there is exactly one place that decides what `?tab=` means.
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { isPersonalOrg } from "@/lib/db";
import { orgTabHref, DEFAULT_ORG_TAB } from "@/lib/org/orgTabs";
import { resolveOrgScope } from "@/lib/org/scope";
import { OrgTabGap } from "@/components/shared/dashboard/OrgTabGap";
import { FleetTabs } from "./FleetTabs";
import { SegmentsSection } from "./SegmentsSection";
import { RepositoriesTabView } from "./RepositoriesTabView";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function RepositoriesTab({
  slug,
  sp,
  mode,
}: {
  slug: string;
  sp: SearchParams;
  mode: "repositories" | "segments";
}) {
  // A PERSONAL workspace's repo list IS its overview (the watchlist lens) — the fleet leaderboard
  // would table scan-less pointer rows and offer watch/schedule/segment controls the fleet APIs
  // refuse for personal orgs (requireFleetOrg). Personal orgs never render either mode of this tab;
  // the layout's nav already hides it, this is the deep-link backstop.
  if (await isPersonalOrg(slug)) redirect(orgTabHref(slug, DEFAULT_ORG_TAB));

  if (mode === "segments") {
    return (
      <div className="stagger-children space-y-6">
        <FleetTabs slug={slug} active="segments" />
        <Suspense fallback={<OrgTabGap minH="min-h-[32rem]" />}>
          <SegmentsSection slug={slug} searchParams={sp} />
        </Suspense>
      </div>
    );
  }

  // Segment + tech-stack scope (?segment= / ?stack=). Called ONCE and the promise is handed to both
  // the leaderboard and Context Health (the OverviewTab / DeliveryTab pattern) — awaiting it in two
  // boundaries costs one lookup, and both panels then read one `getOrgRollupShared` at the same
  // (segmentId, techGroupId). Deliberately NOT awaited here.
  const scope = resolveOrgScope(slug, sp);
  return <RepositoriesTabView slug={slug} sp={sp} scope={scope} />;
}
