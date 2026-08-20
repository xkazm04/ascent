// Org dashboard "Live" tab — the Fleet Command war-room. Seeds each repo's latest standing from the
// org rollup, then hands off to a client component that subscribes to the existing /api/org/scan SSE
// stream and animates the wall (headline tiles, leaderboard, posture mix, movers ticker, AI-Native
// bursts) as results land. The org layout supplies the auth/DB guards.
//
// Migrated onto the org tab shell (docs/ORG-TABS-REFACTOR.md):
//   - SERVER component, filename PINNED as `LiveTab.tsx`; takes `slug` + the resolved `sp` as props
//     since it is no longer a route.
//   - Its old route (src/app/org/[slug]/live/page.tsx) is now a redirect().
//   - LiveWarRoom (the client polling surface) is UNCHANGED — same props, same behavior. Its TV/wall
//     mode is pure component state (`useState` inside LiveWarRoom) plus `document.documentElement.
//     requestFullscreen()`, which fullscreens the whole viewport regardless of DOM nesting depth, so
//     it keeps working unmodified nested inside the tab shell. Its wake lock, aria-live announcer
//     (warRoomAnnounce.ts) and the read-only share view (/live/shared/[token], a separate top-level
//     route unrelated to this tab) are all untouched — see the migration report for the full verdict.

import { LiveWarRoom } from "./LiveWarRoom";
import { toLiveRepoSeeds } from "@/components/org/shared/liveWarRoomShared";
import { buildFleetTimetable } from "./fleetTimetable";
import { TechStackSelector } from "@/components/org/shared/TechStackSelector";
import { getOrgRepoHistories, getOrgRollup, listGoals, listLocalPairings, listOpsState } from "@/lib/db";
import { selfHosted } from "@/lib/env";
import { autopilotEnabled } from "@/lib/local/agent";
import { AutopilotBand } from "./AutopilotBand";
import { resolveStackScope } from "@/lib/org/scope";
import { hasOrgRole } from "@/lib/authz";
import { liveShareEnabled } from "@/lib/live-share";
import type { GoalProgressView } from "@/components/org/shared/goalView";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function LiveTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  // Optional tech-stack scope (Feature 3b): a stack toggle on the live wall — scopes the seeded
  // standing AND the launched scan to that stack's repos, so "Frontend war room" runs only those.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);

  // The goal the wall rallies around — the first not-yet-achieved goal, else the most recent. Its
  // createdAt doubles as the campaign-start baseline for the "since kickoff" delta (WAR-2).
  const goals = await listGoals(slug).catch(() => null);
  const goal = goals?.find((g) => !g.achieved) ?? goals?.[0] ?? null;
  const [rollup, isOwner, histories, ops] = await Promise.all([
    getOrgRollup(slug, goal ? { start: new Date(goal.createdAt) } : undefined, null, techGroupId),
    hasOrgRole(slug, "owner"),
    // Per-repo overall-score history → the fleet-evolution timetable (repos × scan days).
    getOrgRepoHistories(slug, undefined, null, techGroupId).catch(() => []),
    // Ship-loop SSR snapshot (triage / in-flight PRs / landed impact); the band's poll advances it.
    listOpsState(slug).catch(() => null),
  ]);
  if (!rollup) return null;
  const timetable = buildFleetTimetable(histories);
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

  // LOCAL MODE: the paired repos the autopilot band can dispatch into. Empty everywhere but a
  // self-hosted deployment with pairings, and the band renders only then — the wall is unchanged on
  // managed cloud and on unpaired self-hosts.
  const pairedRepos = selfHosted()
    ? (await listLocalPairings(slug).catch(() => [])).filter((r) => r.localPath != null).map((r) => r.fullName)
    : [];

  return (
    <div className="space-y-4">
      {pairedRepos.length > 0 && <AutopilotBand org={slug} pairedRepos={pairedRepos} enabled={autopilotEnabled()} />}
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
        timetable={timetable}
        ops={ops}
        trend={rollup.trend}
        fleetScannedAt={fleetScannedAt}
        attention={attention}
        canShare={canShare}
      />
    </div>
  );
}
