"use client";

import Link from "next/link";
import { reportPermalink } from "@/lib/ui";
import { type LiveRepoSeed } from "@/components/org/liveWarRoomShared";
import { MAX_AUTO_LOOPS, useLiveWarRoom } from "@/components/org/useLiveWarRoom";
import { HeadlineStrip } from "@/components/org/LiveWarRoomStat";
import { WarRoomHeader } from "@/components/org/LiveWarRoomHeader";
import type { GoalProgressView } from "@/components/org/plan/goalView";
import { Leaderboard } from "@/components/org/LiveWarRoomLeaderboard";
import { MoversTicker, PostureMix } from "@/components/org/LiveWarRoomPanels";
import { Celebrations } from "@/components/org/LiveWarRoomCelebrations";

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

  return (
    <div className="strata relative isolate -m-2 overflow-hidden rounded-3xl p-2">
      {/* spotlight wash, like Mission Control, so the wall feels lit from above */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(60rem 40rem at 50% -16%, rgba(59,158,255,0.08), transparent 60%)" }}
      />

      <WarRoomHeader
        slug={slug}
        running={wall.running}
        watchedCount={watchedCount}
        progress={wall.progress}
        pct={wall.pct}
        error={wall.error}
        skipped={wall.skipped}
        launchLabel={wall.launchLabel}
        onStop={wall.stop}
        onLaunch={wall.manualLaunch}
        goal={goal}
        campaignDelta={campaignDeltas?.overall ?? null}
        fleetScannedAt={fleetScannedAt}
        autoLoop={wall.autoLoop}
        onToggleLoop={wall.toggleLoop}
        sound={wall.sound}
        onToggleSound={wall.toggleSound}
        readOnly={readOnly}
        canShare={canShare}
      />

      {/* WAR-2: unattended auto-relaunch budget spent — paused to protect prepaid scan credits. */}
      {wall.loopCapped && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 font-mono text-sm text-amber-300">
          Auto-relaunch paused after {MAX_AUTO_LOOPS} unattended cycles to protect prepaid scan credits. Launch a scan or
          re-enable auto-relaunch to keep looping.
        </p>
      )}

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
      <HeadlineStrip stats={wall.stats} deltas={campaignDeltas} trend={trend} />

      {/* ── Wall: leaderboard (reshuffling) + posture mix + movers ticker ─ */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Leaderboard repos={wall.leaderboard} slug={slug} readOnly={readOnly} className="lg:col-span-2" />
        <div className="flex flex-col gap-4">
          <PostureMix counts={wall.stats.postureCounts} scored={wall.stats.scored} slug={slug} readOnly={readOnly} />
          <MoversTicker ticker={wall.ticker} running={wall.running} readOnly={readOnly} />
        </div>
      </div>

      {/* ── Celebratory bursts: a repo just crossed into AI-Native ───────── */}
      <Celebrations celebrations={wall.celebrations} />
    </div>
  );
}
