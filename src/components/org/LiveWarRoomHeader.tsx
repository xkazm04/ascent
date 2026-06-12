import { shortName } from "@/components/org/liveWarRoomShared";

/** LIVE state + launch/stop controls + run progress bar + currently-scanning caption + error. */
export function WarRoomHeader({
  running,
  watchedCount,
  progress,
  pct,
  error,
  skipped,
  launchLabel,
  onStop,
  onLaunch,
}: {
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
}) {
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
        </div>
      </header>

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
