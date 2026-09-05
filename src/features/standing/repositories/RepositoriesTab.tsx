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
import { getFoundationRollout } from "@/lib/db/org-foundation";
import { orgTabHref, DEFAULT_ORG_TAB } from "@/lib/org/orgTabs";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { FleetTabs } from "./FleetTabs";
import { SegmentsSection } from "./SegmentsSection";
import { RepositoriesLeaderboardPanel } from "./RepositoriesLeaderboardPanel";
import { ContextHealthPanel } from "./context-health/ContextHealthPanel";
import { FoundationRolloutPanel } from "./FoundationRolloutPanel";
import { QueueDepthLine } from "./QueueDepthLine";

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
      {/* The cadence backlog as ONE number, above the table whose per-row "queued" tags were the only
          way to see it (UAT `VICTOR-L1-07`). Suspended separately so a slow queue count never holds
          the leaderboard back. */}
      <Suspense fallback={<OrgTabGap minH="min-h-4" />}>
        <QueueDepthLine slug={slug} />
      </Suspense>
      {/* The leaderboard leads. It is the answer to the question the tab's own name asks ("which
          repos do I have, and where do they stand?"), so it must not be pushed below the fold by a
          derived lens — Context Health used to sit above it and did exactly that. */}
      <Suspense fallback={<OrgTabGap minH="min-h-[40rem]" />}>
        <RepositoriesLeaderboardPanel slug={slug} sp={sp} />
      </Suspense>
      {/* Foundation rollout (moonshot #35): install `.ai/` across the fleet and provision report-back. */}
      <FoundationRolloutPanel slug={slug} rows={await getFoundationRollout(slug)} />
      {/* Context Health (W4 — real): the quality-over-presence lens on the fleet's agent-context
          layer. Fed by each scan's persisted contextHealthJson. Takes `sp` so it resolves the SAME
          ?stack= scope the leaderboard above does — and so both panels share one rollup read. */}
      <Suspense fallback={<OrgTabGap minH="min-h-[28rem]" />}>
        <ContextHealthPanel slug={slug} sp={sp} />
      </Suspense>
    </div>
  );
}
