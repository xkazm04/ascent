// Org dashboard "Live" tab. TWO views over the same fleet, chosen by `?view=`:
//
//   default    → the LOOP COCKPIT: the observatory sky chart (adoption × rigor) as the dominant
//                object, a mode-switching right rail (inspect ⇄ run ⇄ outcome), and the run history.
//   ?view=wall → the original Fleet Command WAR ROOM, unchanged — AutopilotBand + stack selector +
//                LiveWarRoom, with its SSE fold, TV mode, wake lock and share link all intact.
//
// The wall is not deprecated and is not a fallback; it answers "what is the fleet doing right now",
// which is a different question from "what should we improve next". Keeping it addressable by URL is
// also what keeps the kiosk route (/live/shared/[token], which renders LiveWarRoom read-only and is
// deliberately untouched by any of this) honest — it renders the same component this tab does.
//
// SERVER component, filename PINNED as `LiveTab.tsx`; takes `slug` + the resolved `sp` as props.
// Every loop read goes through the db layer directly (getActiveLoopRun / listLoopRuns), never
// through /api/org/loop: the route exists for the browser's poll, and a server component fetching
// its own API would pay a round trip to re-do auth it has already done.

import { LiveWarRoom } from "./LiveWarRoom";
import { LiveCockpit } from "./cockpit";
import { toLiveRepoSeeds } from "@/components/org/shared/liveWarRoomShared";
import { buildFleetTimetable } from "./fleetTimetable";
import { TechStackSelector } from "@/components/org/shared/TechStackSelector";
import { getOrgRepoHistories, getOrgRollup, listGoals, listLocalPairings, listOpsState } from "@/lib/db";
import { getActiveLoopRun, listLoopRuns } from "@/lib/db/loop-runs";
import { selfHosted } from "@/lib/env";
import { autopilotEnabled } from "@/lib/local/agent";
import { AutopilotBand } from "./AutopilotBand";
import { resolveStackScope } from "@/lib/org/scope";
import { hasOrgRole } from "@/lib/authz";
import { liveShareEnabled } from "@/lib/live-share";
import type { GoalProgressView } from "@/components/org/shared/goalView";
import type { ObservatorySeed } from "./observatory";

type SearchParams = { [key: string]: string | string[] | undefined };

/** `?view=wall` with every other param preserved — a view switch must not drop the active stack. */
function wallHref(sp: SearchParams): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "view") continue;
    if (Array.isArray(v)) for (const one of v) params.append(k, one);
    else if (v != null) params.set(k, v);
  }
  if (!params.has("tab")) params.set("tab", "live");
  params.set("view", "wall");
  return `?${params.toString()}`;
}

export async function LiveTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  // Optional tech-stack scope (Feature 3b): a stack toggle on the live wall — scopes the seeded
  // standing AND the launched scan to that stack's repos, so "Frontend war room" runs only those.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const view = typeof sp.view === "string" ? sp.view : "";
  const local = selfHosted();

  // The goal the wall rallies around — the first not-yet-achieved goal, else the most recent. Its
  // createdAt doubles as the campaign-start baseline for the "since kickoff" delta (WAR-2).
  const goals = await listGoals(slug).catch(() => null);
  const goal = goals?.find((g) => !g.achieved) ?? goals?.[0] ?? null;
  const [rollup, isOwner, histories, ops] = await Promise.all([
    getOrgRollup(slug, goal ? { start: new Date(goal.createdAt) } : undefined, null, techGroupId),
    hasOrgRole(slug, "owner"),
    // Per-repo history → the fleet-evolution timetable AND the observatory's trails.
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

  // LOCAL MODE: the paired repos a lane can be dispatched into. Empty everywhere but a self-hosted
  // deployment with pairings — the cockpit turns that into its "pair a checkout first" setup state.
  const pairedRepos = local
    ? (await listLocalPairings(slug).catch(() => [])).filter((r) => r.localPath != null).map((r) => r.fullName)
    : [];

  if (view === "wall") {
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

  // The observatory seeds are the wall's seeds plus each repo's freshness — the field captions a body
  // with when it was last measured, which the SSE-driven wall has no use for.
  const scannedAt = new Map(rollup.repos.map((r) => [r.fullName, r.latest?.scannedAt ?? null]));
  const seeds: ObservatorySeed[] = seed.map((s) => ({ ...s, scannedAt: scannedAt.get(s.fullName) ?? null }));
  // Loop state, read straight from the store. Both degrade to empty without a DB or on managed cloud.
  const [activeRun, runs] = local
    ? await Promise.all([getActiveLoopRun(slug).catch(() => null), listLoopRuns(slug, 20).catch(() => [])])
    : [null, []];

  return (
    <div className="space-y-4">
      {techGroups.length > 0 && (
        <div className="flex justify-end">
          <TechStackSelector groups={techGroups} active={activeStack?.key ?? null} />
        </div>
      )}
      <LiveCockpit
        key={activeStack?.key ?? "all"}
        slug={slug}
        seeds={seeds}
        histories={histories}
        pairedRepos={pairedRepos}
        activeRun={activeRun}
        runs={runs}
        loopEnabled={autopilotEnabled()}
        selfHosted={local}
        isOwner={isOwner}
        wallHref={wallHref(sp)}
      />
    </div>
  );
}
