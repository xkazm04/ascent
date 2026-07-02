"use client";

import { useState } from "react";
import Link from "next/link";
import { shortName } from "@/components/org/liveWarRoomShared";
import { Meter } from "@/components/org/ui";
import { PaceChip, type GoalProgressView } from "@/components/org/plan/goalView";
import { freshness, scoreHex } from "@/lib/ui";

/** Fullscreen the wall + keep the screen awake (best-effort; both fail silently if unsupported). */
async function enterTvMode() {
  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    /* fullscreen denied */
  }
  try {
    await (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock?.request("screen");
  } catch {
    /* wake-lock unsupported / denied */
  }
}

/** Days until a YYYY-MM-DD deadline (negative = past). null when no date. */
function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

/** LIVE state + launch/stop controls + run progress bar + currently-scanning caption + error,
 *  plus (WAR-1/2) the rallying goal banner and (WAR-3) the auto-relaunch toggle. */
export function WarRoomHeader({
  slug,
  running,
  watchedCount,
  progress,
  pct,
  error,
  skipped,
  launchLabel,
  onStop,
  onLaunch,
  goal = null,
  campaignDelta = null,
  fleetScannedAt = null,
  autoLoop = false,
  onToggleLoop,
  sound = false,
  onToggleSound,
  readOnly = false,
  canShare = false,
}: {
  slug: string;
  running: boolean;
  watchedCount: number;
  progress: { done: number; total: number; current: string };
  pct: number;
  error: string | null;
  /** Repos the run skipped for lack of prepaid scan credits — partial coverage must be visible. */
  skipped: number;
  launchLabel: string;
  onStop: () => void;
  onLaunch: () => void;
  goal?: GoalProgressView | null;
  campaignDelta?: number | null;
  /** ISO of the fleet's most recent scan — the idle caption's "fleet scanned Xh ago" freshness. */
  fleetScannedAt?: string | null;
  autoLoop?: boolean;
  onToggleLoop?: () => void;
  /** Opt-in celebration sound (default off). */
  sound?: boolean;
  onToggleSound?: () => void;
  /** Shared/TV view: hide the scan controls (scanning stays session-gated). */
  readOnly?: boolean;
  /** Owner on the authenticated view: can mint a read-only TV share link. */
  canShare?: boolean;
}) {
  const countdown = goal ? daysUntil(goal.targetDate) : null;
  const toGoal = goal ? Math.max(0, goal.target - goal.current) : 0;
  const [share, setShare] = useState<{ busy: boolean; copied: boolean; error: string | null; manualUrl: string | null }>(
    { busy: false, copied: false, error: null, manualUrl: null },
  );

  async function shareTvLink() {
    setShare({ busy: true, copied: false, error: null, manualUrl: null });
    // Step 1 — mint the link. A failure here means there is no link to show.
    let url: string;
    try {
      const res = await fetch("/api/org/live-share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.path) throw new Error(d.error ?? "Couldn't create a share link.");
      url = `${window.location.origin}${d.path}`;
    } catch (e) {
      setShare({ busy: false, copied: false, error: e instanceof Error ? e.message : "Couldn't create a share link.", manualUrl: null });
      return;
    }
    // Step 2 — the link EXISTS server-side now; auto-copy is a convenience that fails on non-secure
    // contexts / denied permission / kiosk browsers. Don't conflate that with "couldn't create a
    // link": on copy failure keep the URL on screen for manual copy instead of discarding it with a
    // misleading "Share failed." (live-war-room #3)
    try {
      await navigator.clipboard.writeText(url);
      setShare({ busy: false, copied: true, error: null, manualUrl: null });
      setTimeout(() => setShare((s) => ({ ...s, copied: false })), 2500);
    } catch {
      setShare({ busy: false, copied: false, error: null, manualUrl: url });
    }
  }

  return (
    <>
      {/* ── Header: LIVE state + launch control + run progress ──────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-mono text-sm uppercase tracking-[0.3em] text-accent">
            <span className={`inline-block h-2 w-2 rounded-full ${running ? "live-dot bg-red-500" : "bg-slate-600"}`} aria-hidden />
            {running ? "Live" : "Fleet Command"}
          </div>
          <h2 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Transformation war-room</h2>
          <p className="mt-1 max-w-xl text-base text-slate-400">
            The whole org&apos;s scan, live — tiles climb, the leaderboard reshuffles, and every repo that crosses into
            AI-Native lights up the wall.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {!readOnly && running && (
              <button
                type="button"
                onClick={onStop}
                className="focus-ring rounded-lg border border-slate-700 px-3 py-2 text-base text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Stop
              </button>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={onLaunch}
                disabled={running || watchedCount === 0}
                className="focus-ring rounded-lg bg-accent px-4 py-2 text-base font-semibold text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {launchLabel}
              </button>
            )}
            <button
              type="button"
              onClick={enterTvMode}
              title="Fullscreen + keep the screen awake for a wall display"
              className="focus-ring rounded-lg border border-slate-700 px-3 py-2 text-base text-slate-300 transition hover:border-accent hover:text-white"
            >
              ⛶ TV mode
            </button>
            {canShare && !readOnly && (
              <button
                type="button"
                onClick={shareTvLink}
                disabled={share.busy}
                title="Copy a signed, expiring read-only link to show this wall on an unauthenticated screen"
                className="focus-ring rounded-lg border border-slate-700 px-3 py-2 text-base text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
              >
                {share.busy ? "Creating…" : share.copied ? "Link copied ✓" : "Share TV link"}
              </button>
            )}
          </div>
          {!readOnly &&
            (watchedCount === 0 ? (
              <p className="font-mono text-sm text-slate-500">Watch some repos on /connect to scan.</p>
            ) : (
              <p className="font-mono text-sm text-slate-500" aria-live="polite" suppressHydrationWarning>
                {running
                  ? `${progress.done}/${progress.total} repos`
                  : `${watchedCount} watched${fleetScannedAt ? ` · scanned ${freshness(fleetScannedAt)}` : ""}`}
              </p>
            ))}
          {readOnly && fleetScannedAt && (
            <p className="font-mono text-sm text-slate-500" suppressHydrationWarning>
              fleet scanned {freshness(fleetScannedAt)}
            </p>
          )}
          {!readOnly && onToggleLoop && watchedCount > 0 && (
            <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500" title="Re-run the live scan automatically for an unattended wall display">
              <input type="checkbox" checked={autoLoop} onChange={onToggleLoop} className="accent-accent" />
              Auto-relaunch every 15 min
            </label>
          )}
          {onToggleSound && (
            <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500" title="Play a short chime when a repo crosses into AI-Native">
              <input type="checkbox" checked={sound} onChange={onToggleSound} className="accent-accent" />
              Sound
            </label>
          )}
          {share.error && <p className="font-mono text-sm text-orange-300">{share.error}</p>}
          {share.manualUrl && (
            <div className="flex flex-col items-end gap-1">
              <span className="font-mono text-sm text-amber-300">Couldn&apos;t auto-copy — copy this link:</span>
              <input
                type="text"
                readOnly
                value={share.manualUrl}
                aria-label="TV share link"
                onFocus={(e) => e.currentTarget.select()}
                className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-sm text-slate-200"
              />
            </div>
          )}
        </div>
      </header>

      {/* WAR-1/2: the goal the wall rallies around — target meter, pace, deadline countdown, and
          movement since the campaign (goal) kicked off. */}
      {goal && (
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm uppercase tracking-widest text-accent">Goal</span>
              <span className="font-medium text-white">{goal.label}</span>
              <PaceChip pace={goal.pace} />
            </div>
            <Link href={`/org/${slug}/plan`} className="font-mono text-sm text-accent hover:text-white">
              manage →
            </Link>
          </div>
          <Meter
            className="mt-2.5"
            value={goal.current}
            threshold={goal.target}
            color={goal.achieved ? "#34d399" : scoreHex(goal.current)}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm text-slate-400">
            <span>
              {goal.metricLabel} {goal.current}/{goal.target}
              {goal.achieved ? " · reached 🎉" : ` · ${toGoal} to goal`}
            </span>
            {campaignDelta != null && (
              <span className={campaignDelta > 0 ? "text-emerald-300" : campaignDelta < 0 ? "text-orange-300" : "text-slate-500"}>
                {campaignDelta > 0 ? "+" : ""}
                {campaignDelta} since kickoff
              </span>
            )}
            {countdown != null && (
              <span className={countdown < 0 ? "text-orange-300" : countdown <= 7 ? "text-amber-300" : "text-slate-400"}>
                {countdown < 0 ? `${-countdown}d past deadline` : `${countdown}d to deadline`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* run progress bar + currently-scanning caption */}
      {running && (
        <div className="mt-4">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-label="Scan progress"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${progress.done} of ${progress.total} repos scanned`}
          >
            <div className="h-full rounded-full bg-accent transition-all motion-reduce:transition-none" style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
          {progress.current && (
            <p className="mt-1 truncate font-mono text-sm text-slate-500" aria-live="polite">
              scanning {shortName(progress.current)}…
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-base text-danger-soft">{error}</p>
      )}
      {skipped > 0 && (
        <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-base text-warn">
          {skipped} {skipped === 1 ? "repo" : "repos"} skipped — out of scan credits.
        </p>
      )}
    </>
  );
}
