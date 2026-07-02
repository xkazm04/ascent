// /org/[slug]/live — the Fleet Command war-room. Seeds each repo's latest standing from the
// org rollup, then hands off to a client component that subscribes to the existing
// /api/org/scan SSE stream and animates the wall (headline tiles, leaderboard, posture mix,
// movers ticker, AI-Native bursts) as results land. The org layout supplies the auth/DB guards.

import { LiveWarRoom } from "@/components/org/LiveWarRoom";
import { toLiveRepoSeeds } from "@/components/org/liveWarRoomShared";
import { TechStackSelector } from "@/components/org/TechStackSelector";
import { getOrgRollup, listGoals } from "@/lib/db";
import { resolveStackScope } from "@/lib/org/scope";
import { hasOrgRole } from "@/lib/authz";
import { liveShareEnabled } from "@/lib/live-share";
import type { GoalProgressView } from "@/components/org/plan/goalView";

export const dynamic = "force-dynamic";

export default async function OrgLivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  // Optional tech-stack scope (Feature 3b): a stack toggle on the live wall — scopes the seeded
  // standing AND the launched scan to that stack's repos, so "Frontend war room" runs only those.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);

  // The goal the wall rallies around — the first not-yet-achieved goal, else the most recent. Its
  // createdAt doubles as the campaign-start baseline for the "since kickoff" delta (WAR-2).
  const goals = await listGoals(slug).catch(() => null);
  const goal = goals?.find((g) => !g.achieved) ?? goals?.[0] ?? null;
  const [rollup, isOwner] = await Promise.all([
    getOrgRollup(slug, goal ? { start: new Date(goal.createdAt) } : undefined, null, techGroupId),
    hasOrgRole(slug, "owner"),
  ]);
  if (!rollup) return null;
  const canShare = isOwner && liveShareEnabled();

  const watched = rollup.repos.filter((r) => r.watched).length;
  const seed = toLiveRepoSeeds(rollup.repos);
  // When a stack is active, launch() scans ONLY this stack's repos (the /api/org/scan `repos` filter),
  // so the wall doesn't animate out-of-stack repos. Undefined = scan the whole watched fleet (default).
  const scanRepos = activeStack ? rollup.repos.map((r) => r.fullName) : undefined;

  // Freshness for the header caption: the most recent scan anywhere in the (scoped) fleet.
  const fleetScannedAt = rollup.repos.reduce<string | null>((acc, r) => {
    const at = r.latest?.scannedAt ?? null;
    return at && (!acc || at > acc) ? at : acc;
  }, null);
  // Watched repos whose last scan attempt failed — the wall's needs-attention strip.
  const attention = rollup.repos
    .filter((r) => r.watched && r.lastScanStatus === "error")
    .map((r) => ({ fullName: r.fullName, name: r.name, error: r.lastScanError }));

  return (
    <div className="space-y-4">
      {techGroups.length > 0 && (
        <div className="flex justify-end">
          <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />
        </div>
      )}
      {/* Re-key on the active stack so a toggle remounts the wall with the scoped seed (the SSE fold
          otherwise owns `repos` and a prop change wouldn't re-seed it). */}
      <LiveWarRoom
        key={activeStack?.key ?? "all"}
        slug={slug}
        watchedCount={watched}
        seed={seed}
        scanRepos={scanRepos}
        goal={(goal as GoalProgressView | null) ?? null}
        campaignDeltas={goal ? rollup.deltas ?? null : null}
        trend={rollup.trend}
        fleetScannedAt={fleetScannedAt}
        attention={attention}
        canShare={canShare}
      />
    </div>
  );
}
