"use client";

import { useState } from "react";
import Link from "next/link";
import { reportPermalink } from "@/lib/ui";
import { type LiveRepoSeed } from "@/components/org/shared/liveWarRoomShared";
import { useLiveWarRoom } from "@/features/inflight/live/useLiveWarRoom";
import { HeadlineStrip } from "@/features/inflight/live/LiveWarRoomStat";
import { WarRoomHeader, releaseWakeLock } from "@/features/inflight/live/LiveWarRoomHeader";
import type { GoalProgressView } from "@/components/org/shared/goalView";
import { FleetTimetablePanel } from "@/features/inflight/live/LiveWarRoomTimetable";
import type { FleetTimetable } from "@/features/inflight/live/fleetTimetable";
import { ShipLoopBand } from "@/features/inflight/live/LiveWarRoomOps";
import { Leaderboard } from "@/features/inflight/live/LiveWarRoomLeaderboard";
import { MoversTicker, PostureMix } from "@/features/inflight/live/LiveWarRoomPanels";
import { LiveWarRoomTv } from "@/features/inflight/live/LiveWarRoomTv";
import { Celebrations } from "@/features/inflight/live/LiveWarRoomCelebrations";
import type { OpsState } from "@/lib/db";

export type { LiveRepoSeed };

/** A watched repo whose latest scan attempt failed — surfaced as the needs-attention strip. */
export interface AttentionRepo {
  fullName: string;
  name: string;
  error: string | null;
}

export function LiveWarRoom({
  slug,
  watchedCount,
  seed,
  scanRepos,
  goal = null,
  campaignDeltas = null,
  timetable,
  ops = null,
  trend,
  fleetScannedAt = null,
  attention,
  readOnly = false,
  canShare = false,
}: {
  slug: string;
  watchedCount: number;
  seed: LiveRepoSeed[];
  /** When set (a tech-stack scope is active), launch scans ONLY these repos via /api/org/scan's
   *  `repos` filter, so the wall stays scoped to the stack. Undefined = the whole watched fleet. */
  scanRepos?: string[];
  /** The active goal the wall rallies around (target meter + pace + deadline countdown). */
  goal?: GoalProgressView | null;
  /** Per-metric score movement since the campaign (goal) started — the strip's delta chips and the
   *  goal banner's "since kickoff" line. Null without a goal/baseline. */
  campaignDeltas?: { overall: number; adoption: number; rigor: number } | null;
  /** The repos×scans fleet-evolution grid (overall score per scan day) — the main-wall centerpiece,
   *  with per-repo scan selection. Built server-side from getOrgRepoHistories. */
  timetable: FleetTimetable;
  /** SSR snapshot of the ship loop (triage / in-flight PRs / landed impact). Null hides the band
   *  (kiosk view, or a deployment without the loop's prerequisites). */
  ops?: OpsState | null;
  /** Org-average trend points (oldest → newest) for the maturity sparkline. */
  trend?: { date: string; avg: number }[];
  /** ISO of the fleet's most recent scan, for the "fleet scanned Xh ago" freshness line. */
  fleetScannedAt?: string | null;
  /** Watched repos whose last scan attempt failed — the needs-attention strip (auth view only). */
  attention?: AttentionRepo[];
  /** Shared-link / TV view: no scan trigger (scanning stays session-gated), just the current wall. */
  readOnly?: boolean;
  /** The viewer may mint a read-only TV share link (owner on the authenticated view). */
  canShare?: boolean;
}) {
  const wall = useLiveWarRoom({ slug, watchedCount, seed, scanRepos, readOnly });
  // Dynamic-UI TV mode: one lifecycle-relevant stage at a time (authenticated wall only — the stage
  // machine's ship-loop poller is session-gated, so the kiosk keeps its plain fullscreen).
  const [tvMode, setTvMode] = useState(false);
  const dynamicTv = !readOnly && tvMode;
  // Which repos the next scan runs — driven by the timetable's per-repo checkboxes. Default EMPTY:
  // scanning is explicit now (no auto-relaunch), so nothing runs until the operator picks repos.
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(() => new Set());
  const scanSelected = () => wall.launchRepos([...selectedRepos]);

  return (
    <div className="strata relative isolate -m-2 overflow-hidden rounded-3xl p-2">
      {/* spotlight wash, like Mission Control, so the wall feels lit from above */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(60rem 40rem at 50% -16%, rgba(59,158,255,0.08), transparent 60%)" }}
      />

      {dynamicTv ? (
        <LiveWarRoomTv
          slug={slug}
          wall={wall}
          opsInitial={ops}
          goal={goal}
          deltas={campaignDeltas}
          trend={trend}
          onVerify={wall.launchRepos}
          selectedRepos={selectedRepos}
          onScanSelected={scanSelected}
          onExit={() => {
            // Exiting TV mode must also drop the screen wake lock — otherwise the display stays
            // forced-awake for the tab's lifetime (live-war-room 07-16 #3).
            releaseWakeLock();
            setTvMode(false);
          }}
        />
      ) : (
        <>
          <WarRoomHeader
            slug={slug}
            running={wall.running}
            watchedCount={watchedCount}
            progress={wall.progress}
            pct={wall.pct}
            error={wall.error}
            skipped={wall.skipped}
            onStop={wall.stop}
            goal={goal}
            campaignDelta={campaignDeltas?.overall ?? null}
            fleetScannedAt={fleetScannedAt}
            sound={wall.sound}
            onToggleSound={wall.toggleSound}
            readOnly={readOnly}
            canShare={canShare}
            onEnterTv={readOnly ? undefined : () => setTvMode(true)}
          />

          {/* ── Fleet evolution timetable: repos × scans, pick which repos to run. Sits FIRST after the
              header — the fleet's climb over time is the wall's headline. ── */}
          <FleetTimetablePanel
            data={timetable}
            slug={slug}
            selected={selectedRepos}
            onSetSelected={setSelectedRepos}
            onScanSelected={wall.launchRepos}
            scanning={wall.running}
            readOnly={readOnly}
          />

          {/* Needs attention: watched repos whose last scan attempt failed. Each name jumps to the repo's
              report (its last good standing + error context) so the wall points at the fix, not just the fact. */}
          {!readOnly && attention && attention.length > 0 && (
            <p className="mt-3 rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 font-mono text-sm text-orange-300">
              {attention.length} {attention.length === 1 ? "repo" : "repos"} failed the last scan:{" "}
              {attention.slice(0, 3).map((r, i) => (
                <span key={r.fullName}>
                  {i > 0 && ", "}
                  <Link
                    href={reportPermalink(r.fullName)}
                    title={r.error ?? undefined}
                    className="underline decoration-orange-500/50 underline-offset-2 hover:text-white"
                  >
                    {r.name}
                  </Link>
                </span>
              ))}
              {attention.length > 3 && ` +${attention.length - 3} more`}
            </p>
          )}

          {/* ── Headline command strip: four metrics, campaign deltas, trend spark ── */}
          {/* G6-01: the read-only share screen exists to be projected ("show this wall on an
              unauthenticated screen"), so it gets the wall type scale; the authenticated wall is
              read on a laptop and keeps the panel scale. */}
          <HeadlineStrip
            stats={wall.stats}
            deltas={campaignDeltas}
            trend={trend}
            scale={readOnly ? "wall" : "panel"}
            running={wall.running}
          />

          {/* ── Standing panels: leaderboard + live movers + posture mix. Mounted on the FLAT wall
              and the read-only kiosk — not only inside Dynamic TV stages — so the header's promise
              ("the leaderboard reshuffles") holds on every surface, including the unauthenticated
              shared screen. Their readOnly variants keep session-gated links suppressed on the kiosk.
              Previously these lived only in TvStanding/TvScanning (auth-only), which left the kiosk
              with no leaderboard at all and PostureMix as dead code (live-war-room #1). ── */}
          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            <Leaderboard repos={wall.leaderboard} slug={slug} readOnly={readOnly} className="lg:col-span-2" />
            <div className="flex flex-col gap-5">
              <MoversTicker ticker={wall.ticker} running={wall.running} readOnly={readOnly} />
              <PostureMix counts={wall.stats.postureCounts} scored={wall.stats.scored} slug={slug} readOnly={readOnly} />
            </div>
          </div>

          {/* ── Ship loop: triage directions → watch PRs → measure landed impact ── */}
          {!readOnly && ops && <ShipLoopBand slug={slug} initial={ops} onVerify={wall.launchRepos} />}
        </>
      )}

      {/* ── Celebratory bursts: a repo just crossed into AI-Native ───────── */}
      <Celebrations celebrations={wall.celebrations} />
    </div>
  );
}
