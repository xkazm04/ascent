"use client";

// The live war-room's state machine, extracted verbatim from LiveWarRoom.tsx so the component
// stays a pure layout shell (300-LOC rule). Owns the SSE scan stream fold, the launch/stop
// lifecycle, the read-only kiosk refresh, and the celebration timers. Scanning is now explicit
// (manual launch of the selected repos) — the old unattended 15-min auto-relaunch was removed so a
// forgotten wall can't silently burn prepaid credits. The pure fold rules live in liveWarRoomFold.ts.
// Split further for the 200-LOC src/features cap: the celebration/chime lane lives in
// liveWarRoomCelebrate.ts, the kiosk poll in liveWarRoomKiosk.ts, and the scan run in
// liveWarRoomLaunch.ts. This file owns the state those three read and write.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LiveRepo,
  type LiveRepoSeed,
  type Mover,
  type Phase,
} from "@/components/org/shared/liveWarRoomShared";
import { computeLeaderboard, computeStats, foldRepoEvent, progressPct } from "@/features/inflight/live/liveWarRoomFold";
import { useLiveWarRoomCelebrations } from "@/features/inflight/live/liveWarRoomCelebrate";
import { useLiveWarRoomKiosk } from "@/features/inflight/live/liveWarRoomKiosk";
import { runLiveScan, type LiveProgress } from "@/features/inflight/live/liveWarRoomLaunch";

export function useLiveWarRoom({
  slug,
  watchedCount,
  seed,
  scanRepos,
  readOnly = false,
}: {
  slug: string;
  watchedCount: number;
  seed: LiveRepoSeed[];
  scanRepos?: string[];
  readOnly?: boolean;
}) {
  const [repos, setRepos] = useState<Record<string, LiveRepo>>(() =>
    Object.fromEntries(seed.map((r) => [r.fullName, { ...r, updatedAt: 0 }])),
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<LiveProgress>({ done: 0, total: watchedCount, current: "", stage: null });
  const [error, setError] = useState<string | null>(null);
  // Repos the server skipped for lack of prepaid scan credits (`notice` up front, per-repo
  // `skipped` events mid-run, authoritative total on `result`). Surfaced as a warn line so a
  // credit-truncated run can never read as a clean full-fleet success.
  const [skipped, setSkipped] = useState(0);
  const [ticker, setTicker] = useState<Mover[]>([]);
  const { celebrations, setCelebrations, sound, toggleSound, pushCelebration } = useLiveWarRoomCelebrations();

  // Mirror of `repos` so the SSE handler can read the latest standing synchronously (it also
  // writes this ref itself for back-to-back events within a tick). Synced via effect, never
  // touched during render.
  const reposRef = useRef(repos);
  useEffect(() => {
    reposRef.current = repos;
  }, [repos]);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Tear down any in-flight scan on unmount (pending celebration timers are torn down by
  // useLiveWarRoomCelebrations).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Fold one streamed `repo` result into the live state: update the repo, push to the ticker,
  // and fire a celebration when it crosses the threshold into AI-Native. Skipped/error/malformed
  // events are ticker-only (or dropped) — they must never overwrite a repo's real seeded standing.
  const onRepo = useCallback(
    (d: Record<string, unknown>) => {
      if (!String(d.repo ?? "")) return;
      // Snapshot the pre-update repos so the fold's `prev`/`delta`/celebration are computed against
      // the standing as it was when this event arrived (matches the prior single-`id` fold). The
      // ticker is folded against the latest `t` inside setTicker below; the repos/celebration/skip
      // pieces don't depend on the ticker, so an empty placeholder is fine for this first fold.
      const prevRepos = reposRef.current;
      // Stamp the id this event WOULD take, then fold. Drop malformed/invalid events before
      // committing the id (`++idRef.current`), preserving the prior placement where the monotonic id
      // only advances on events that actually land.
      const id = idRef.current + 1;
      const result = foldRepoEvent(prevRepos, [], d, id);
      const lands = result.repos !== null || result.ticker !== null || result.skippedDelta !== 0 || result.celebration !== null;
      if (!lands) return;
      idRef.current = id;

      if (result.repos !== null) {
        reposRef.current = result.repos;
        setRepos(result.repos);
      }
      if (result.skippedDelta) setSkipped((n) => n + result.skippedDelta);
      // Re-fold against the latest ticker inside the functional update so back-to-back events within
      // a tick still see each other's rows (matches the prior `setTicker((t) => [row, ...t])`).
      setTicker((t) => foldRepoEvent(prevRepos, t, d, id).ticker ?? t);
      if (result.celebration) pushCelebration(result.celebration);
    },
    [pushCelebration],
  );

  const launch = useCallback(
    (reposOverride?: string[]) =>
      runLiveScan(
        { slug, watchedCount, scanRepos, abortRef, onRepo, setError, setSkipped, setTicker, setCelebrations, setPhase, setProgress },
        reposOverride,
      ),
    [onRepo, slug, watchedCount, scanRepos, setCelebrations],
  );

  // A manual launch counts as interaction: reset the unattended auto-relaunch budget + clear the cap
  // notice so the loop (if enabled) gets a fresh N cycles.
  const manualLaunch = useCallback(() => {
    void launch();
  }, [launch]);

  // Ship-loop verify rescan: scan ONLY the given repos (a merged PR's repo) so the wall measures
  // the merge's impact without burning a full-fleet run. Skipped silently while a scan is already
  // in flight — the verify pass picks the impact up from whatever scan lands next anyway.
  const launchRepos = useCallback(
    (fullNames: string[]) => {
      if (fullNames.length === 0) return;
      void launch(fullNames);
    },
    [launch],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setProgress((p) => ({ ...p, current: "", stage: null }));
  }, []);

  useLiveWarRoomKiosk({ readOnly, seed, reposRef, setRepos });

  const stats = useMemo(() => computeStats(repos), [repos]);
  const leaderboard = useMemo(() => computeLeaderboard(repos), [repos]);

  const running = phase === "running";
  // G6-08: clamped to [0,100] — see progressPct in liveWarRoomFold.ts for why the raw ratio can
  // exceed 1 on a credit-truncated run.
  const pct = progressPct(progress.done, progress.total);
  const launchLabel =
    phase === "idle" ? "▶ Launch live scan" : phase === "done" ? "↻ Re-run live scan" : phase === "error" ? "↻ Retry scan" : "Scanning…";

  return {
    stats,
    leaderboard,
    ticker,
    celebrations,
    phase,
    running,
    pct,
    progress,
    error,
    skipped,
    sound,
    launchLabel,
    manualLaunch,
    launchRepos,
    stop,
    toggleSound,
  };
}
