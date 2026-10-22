// The Repositories tab's leaderboard data region — moved from the old page.tsx body
// (docs/ORG-TABS-REFACTOR.md), minus the personal-org guard and the Segments branch (both now live
// in RepositoriesTab, the orchestrator).
//
// The segment MANAGER (RepoSegmentsPanel — create/recolor/delete a segment, tag repos into it) used
// to sit here, above the leaderboard. It now lives on the Segments view (SegmentsSection), which is
// where a user goes to think about segments and where its absence left an empty state that could only
// point back here. Segment membership for the bulk bar rides the shared `resolveOrgScope` promise.

import Link from "next/link";
import type { ReactNode } from "react";
import { RepositoriesViewV2 } from "./RepositoriesView.v2";
import { OrgEmpty, POSTURE_ORDER } from "@/components/shared/dashboard/ui";
import { MissingReposPanelV2 } from "./MissingReposPanel.v2";
import { getOrgRollupShared, listMissingRepos } from "@/lib/db";
import type { OrgScope } from "@/lib/org/scope";
import { isAppConfigured } from "@/lib/github/app";
import { orgTabHref } from "@/lib/org/orgTabs";
import { NextMoveLink } from "@/components/shared/dashboard/NextMoveLink";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function RepositoriesLeaderboardPanel({
  slug,
  sp,
  scope,
  queue,
}: {
  slug: string;
  sp: SearchParams;
  /** SHARED promise created once in RepositoriesTab and awaited here and in Context Health. */
  scope: Promise<OrgScope>;
  /** The queue-depth line, slotted into the toolbar region so it keeps its own Suspense boundary. */
  queue?: ReactNode;
}) {
  // Segment + tech-stack scope: the same SegmentSelector the rest of the dashboard uses. The two
  // filters compose (segment AND stack); a bogus id/key falls back to the whole fleet.
  const resolved = await scope;
  const { segments, segmentId, techGroupId, activeStack } = resolved;
  // Request-scoped: Context Health below this panel asks for the SAME scoped rollup, and the tab used
  // to run two full ones per render. `getOrgRollupShared` normalizes null/undefined args so the two
  // calls key identically and collapse into one read.
  const rollup = await getOrgRollupShared(slug, undefined, segmentId, techGroupId);
  // Same empty-state contract as the overview: don't render a blank panel inside the org shell when
  // there's no fleet data to table — point the user at how to populate it (tabs stay visible).
  if (!rollup) {
    return (
      <OrgEmpty
        title="No repositories to show"
        body="This organization has no scanned repositories yet. Scan some repositories to populate the fleet view."
        href={orgTabHref(slug, "overview")}
        cta="← Org overview"
      />
    );
  }

  // Autoscan scheduling needs the GitHub App (the route 503s without it); the org dashboard already
  // implies a DB. When the App isn't configured, the cadence control renders disabled with a hint
  // rather than vanishing, so the capability stays discoverable.
  const schedulable = isAppConfigured();

  // Rule B (NextMoveLink.tsx): Read would be empty too until a repository has been scanned, so the
  // onward link waits for scanned data. A segment/stack scope that empties the view is a filter, not
  // "no data yet", so a scoped view keeps the link.
  const nextMove = rollup.scannedCount > 0 || segmentId || techGroupId ? <NextMoveLink href={orgTabHref(slug, "overview")} to="overview" /> : null;

  // A second route to the same stage's readiness matrix; the next move stays alone. Waits for scanned data like it.
  const related =
    rollup.scannedCount > 0 || segmentId || techGroupId ? (
      <nav aria-label="Related views" className="flex justify-end">
        <Link href={orgTabHref(slug, "passports")} className="focus-ring type-caption text-accent transition hover:text-white">
          Repo passports →
        </Link>
      </nav>
    ) : null;

  const leaderboard = [...rollup.repos].sort((a, b) => (b.latest?.overall ?? -1) - (a.latest?.overall ?? -1));

  // ?posture= filter (deep-linked from the Overview's posture bar): scope the leaderboard to
  // repos whose LATEST scan sits in that posture quadrant. A bogus value falls back to the whole fleet
  // (same contract as the segment/stack scopes). Tagging (RepoSegmentsPanel) stays full-fleet; the CSV
  // export follows the active posture/stack scope (repositories-segments #3) so the file matches the
  // on-screen numbers.
  const postureParam = typeof sp.posture === "string" ? sp.posture : null;
  const posture = postureParam && (POSTURE_ORDER as readonly string[]).includes(postureParam) ? postureParam : null;
  const visible = posture ? leaderboard.filter((r) => r.latest?.posture === posture) : leaderboard;

  // Chip-row filter surface: counts per posture in the active segment/stack (they ARE the
  // navigation), hrefs preserve that scope so picking a posture cannot drop ?segment= / ?stack=.
  const postureCounts = new Map<string, number>();
  for (const r of leaderboard) if (r.latest) postureCounts.set(r.latest.posture, (postureCounts.get(r.latest.posture) ?? 0) + 1);
  const scopeQs = `${segmentId ? `&segment=${encodeURIComponent(segmentId)}` : ""}${activeStack ? `&stack=${encodeURIComponent(activeStack.key)}` : ""}`;
  const base = orgTabHref(slug, "repositories");
  const chipHref = (p: string | null) => {
    const sep = base.includes("?") ? "&" : "?";
    return p ? `${base}${sep}posture=${p}${scopeQs}` : scopeQs ? `${base}${sep}${scopeQs.slice(1)}` : base;
  };

  // Watched repos GitHub's last COMPLETE listing didn't contain (renamed/transferred/deleted/private).
  // Renders nothing when the list is empty, so the tab is unchanged for a healthy fleet.
  const missing = await listMissingRepos(slug);

  // The export threads the ACTIVE posture/stack/segment scope through, so "Export CSV" can never
  // contradict the filtered table it sits next to (repositories-segments #3). Segment was the one
  // of those three the link used to drop, so a segment-scoped table still downloaded the fleet.
  const csvHref = `/api/org/repositories?org=${encodeURIComponent(slug)}&format=csv${posture ? `&posture=${encodeURIComponent(posture)}` : ""}${segmentId ? `&segment=${encodeURIComponent(segmentId)}` : ""}${activeStack ? `&stack=${encodeURIComponent(activeStack.key)}` : ""}`;
  const csvTitle = posture || segmentId || activeStack ? "Download the currently filtered repos as CSV" : "Download the full fleet as CSV";

  return (
    <RepositoriesViewV2
      slug={slug}
      rollup={rollup}
      leaderboard={leaderboard}
      visible={visible}
      posture={posture}
      postureCounts={postureCounts}
      chipHref={chipHref}
      csvHref={csvHref}
      scope={resolved}
      schedulable={schedulable}
      missing={<MissingReposPanelV2 org={slug} repos={missing} />}
      queue={queue}
      nextMove={
        <>
          {related}
          {nextMove}
        </>
      }
    />
  );
}
