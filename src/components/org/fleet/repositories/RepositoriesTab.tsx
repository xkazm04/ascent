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
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { FleetTabs } from "./FleetTabs";
import { SegmentsSection } from "./SegmentsSection";
import { RepositoriesLeaderboardPanel } from "./RepositoriesLeaderboardPanel";
import { ContextHealthPanel } from "./context-health/ContextHealthPanel";

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

  return (
    <div className="stagger-children space-y-6">
      <FleetTabs slug={slug} active="repositories" />
      {/* PROTOTYPE (P4 — Context Health): a quality-over-presence lens on the fleet's agent-context
          layer, anchored above the leaderboard. Behind its own variant switcher; remove this block
          to restore the tab exactly. */}
      <Suspense fallback={<OrgTabGap minH="min-h-[28rem]" />}>
        <ContextHealthPanel slug={slug} />
      </Suspense>
      <Suspense fallback={<OrgTabGap minH="min-h-[40rem]" />}>
        <RepositoriesLeaderboardPanel slug={slug} sp={sp} />
      </Suspense>
    </div>
  );
}
