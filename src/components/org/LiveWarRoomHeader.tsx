import Link from "next/link";
import { shortName } from "@/components/org/liveWarRoomShared";
import { Meter } from "@/components/org/ui";
import { PaceChip, type GoalProgressView } from "@/components/org/plan/goalView";
import { scoreHex } from "@/lib/ui";

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
  autoLoop = false,
  onToggleLoop,
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
  autoLoop?: boolean;
  onToggleLoop?: () => void;
}) {
  const countdown = goal ? daysUntil(goal.targetDate) : null;
  const toGoal = goal ? Math.max(0, goal.target - goal.current) : 0;
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
            {running && (
              <button
                type="button"
                onClick={onStop}
                className="focus-ring rounded-lg border border-slate-700 px-3 py-2 text-base text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={onLaunch}
              disabled={running || watchedCount === 0}
              className="focus-ring rounded-lg bg-accent px-4 py-2 text-base font-semibold text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              {launchLabel}
            </button>
          </div>
          {watchedCount === 0 ? (
            <p className="font-mono text-sm text-slate-500">Watch some repos on /connect to scan.</p>
          ) : (
            <p className="font-mono text-sm text-slate-500" aria-live="polite">
              {running ? `${progress.done}/${progress.total} repos` : `${watchedCount} watched`}
            </p>
          )}
          {onToggleLoop && watchedCount > 0 && (
            <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500" title="Re-run the live scan automatically for an unattended wall display">
              <input type="checkbox" checked={autoLoop} onChange={onToggleLoop} className="accent-accent" />
              Auto-relaunch every 15 min
            </label>
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
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
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
