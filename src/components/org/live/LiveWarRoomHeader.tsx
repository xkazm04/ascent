"use client";

import { useState } from "react";
import { shortName } from "@/components/org/shared/liveWarRoomShared";
import { type GoalProgressView } from "@/components/org/shared/goalView";
import { freshness } from "@/lib/ui";
import { GoalBanner } from "./LiveWarRoomGoalBanner";
import { enterTvMode, releaseWakeLock } from "./liveWakeLock";

// Wake-lock / TV-mode manager lives in ./liveWakeLock.ts; re-exported here so existing importers
// (LiveWarRoom.tsx, LiveWarRoomWakeLock.dom.test.ts) keep their import path unchanged.
export { enterTvMode, releaseWakeLock };

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
  sound = false,
  onToggleSound,
  readOnly = false,
  canShare = false,
  onEnterTv,
}: {
  slug: string;
  running: boolean;
  watchedCount: number;
  progress: { done: number; total: number; current: string };
  pct: number;
  error: string | null;
  /** Repos the run skipped for lack of prepaid scan credits — partial coverage must be visible. */
  skipped: number;
  /** Optional launch trigger — the main wall now scans from the timetable, so it's omitted there;
   *  kept for any surface that still wants a header-level launch. */
  launchLabel?: string;
  onStop: () => void;
  onLaunch?: () => void;
  goal?: GoalProgressView | null;
  campaignDelta?: number | null;
  /** ISO of the fleet's most recent scan — the idle caption's "fleet scanned Xh ago" freshness. */
  fleetScannedAt?: string | null;
  /** Opt-in celebration sound (default off). */
  sound?: boolean;
  onToggleSound?: () => void;
  /** Shared/TV view: hide the scan controls (scanning stays session-gated). */
  readOnly?: boolean;
  /** Owner on the authenticated view: can mint a read-only TV share link. */
  canShare?: boolean;
  /** Enter Dynamic-UI TV mode (state-driven single-stage wall). Undefined on the kiosk view. */
  onEnterTv?: () => void;
}) {
  const safePct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
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
            {!readOnly && onLaunch && (
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
              onClick={() => {
                // Dynamic-UI TV mode (state-driven single-stage wall) + fullscreen + wake-lock; the
                // kiosk view has no onEnterTv, so there it stays a plain fullscreen.
                void enterTvMode();
                onEnterTv?.();
              }}
              title={onEnterTv ? "Dynamic TV mode: one lifecycle-relevant panel at a time, fullscreen for a wall" : "Fullscreen + keep the screen awake for a wall display"}
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
              // The ONE polite region for a run: the coalesced "done/total repos" progress count
              // (aria-atomic so the whole short count reads each update). Keeping a single announcer
              // is why the per-repo "scanning…" caption below is not itself a live region.
              <p className="font-mono text-sm text-slate-500" aria-live="polite" aria-atomic="true" suppressHydrationWarning>
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
          {/* G6-09: session-gated like every other control. A shared/TV viewer has no scan to
              celebrate and no persisted preference worth setting, so a checkbox that can never do
              anything for them is worse than no checkbox. */}
          {!readOnly && onToggleSound && (
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

      {/* WAR-1/2: the goal the wall rallies around (./LiveWarRoomGoalBanner). */}
      {goal && <GoalBanner slug={slug} goal={goal} campaignDelta={campaignDelta} />}

      {/* run progress bar + currently-scanning caption */}
      {running && (
        <div className="mt-4">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-label="Scan progress"
            aria-valuenow={safePct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${progress.done} of ${progress.total} repos scanned`}
          >
            {/* Floor of 3% so a just-started run still shows a sliver; ceiling of 100 so a
                credit-truncated run can't overrun the track (G6-08 — clamped at source in
                useLiveWarRoom, re-clamped here because `pct` is a prop). */}
            <div className="h-full rounded-full bg-accent transition-all motion-reduce:transition-none" style={{ width: `${Math.min(100, Math.max(3, safePct))}%` }} />
          </div>
          {progress.current && (
            // NOT a live region: the currently-scanning repo name changes on every landed result, so
            // announcing it floods a polite region during a full-fleet run (it never finishes reading).
            // The single run announcer is the coalesced "done/total repos" count above; this caption
            // is a visual-only status (matching the TV scanning stage, which likewise omits aria-live).
            <p className="mt-1 truncate font-mono text-sm text-slate-500" suppressHydrationWarning>
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
