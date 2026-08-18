"use client";

// Dynamic-UI TV mode orchestrator. Instead of full-screening the whole scrolling wall, this renders
// ONE lifecycle-relevant stage at a time (computeTvStages), big enough for a wall across the room,
// and rotates through the states that have something to show — while a live scan LOCKS the wall to
// the scanning stage. It owns the ship-loop poller in TV mode (the normal band is unmounted here, so
// there's never a double poller), and exits cleanly on Esc / leaving fullscreen (rotation/pause/key
// handling lives in ./useTvRotation.ts; the header controls in ./LiveWarRoomTvHeader.tsx).

import { useCallback, useEffect, useRef } from "react";
import { useShipLoop } from "@/features/inflight/live/useShipLoop";
import { computeTvStages, type TvStageId } from "@/features/inflight/live/liveTvStages";
import { TvDecide, TvInflight, TvScanning, TvStanding, type TvStageData } from "@/features/inflight/live/LiveWarRoomTvStages";
import { useTvRotation } from "./useTvRotation";
import { LiveWarRoomTvHeader } from "./LiveWarRoomTvHeader";
import type { OpsState } from "@/lib/db";
import type { OpsView } from "@/features/inflight/live/liveWarRoomOpsShared";
import type { GoalProgressView } from "@/components/org/shared/goalView";
import type { LiveRepo, Mover } from "@/components/org/shared/liveWarRoomShared";

interface TvWall {
  stats: TvStageData["stats"];
  leaderboard: LiveRepo[];
  ticker: Mover[];
  running: boolean;
  pct: number;
  progress: { done: number; total: number; current: string };
}

export function LiveWarRoomTv({
  slug,
  wall,
  opsInitial,
  goal,
  deltas,
  trend,
  onVerify,
  selectedRepos,
  onScanSelected,
  onExit,
}: {
  slug: string;
  wall: TvWall;
  opsInitial: OpsState | null;
  goal: GoalProgressView | null;
  deltas: { overall: number; adoption: number; rigor: number } | null;
  trend?: { date: string; avg: number }[];
  onVerify: (fullNames: string[]) => void;
  /** Repos picked on the timetable before entering TV mode — the manual retrigger's scan set. */
  selectedRepos: Set<string>;
  /** Launch a scan of the selected repos (the manual retrigger; auto-relaunch was removed). */
  onScanSelected: () => void;
  onExit: () => void;
}) {
  // TV walls close the loop themselves: a merged PR auto-fires the scoped verify rescan.
  const onVerifyRef = useRef(onVerify);
  useEffect(() => {
    onVerifyRef.current = onVerify;
  }, [onVerify]);
  const onMerged = useCallback((repos: string[]) => onVerifyRef.current(repos), []);
  const loop = useShipLoop({ slug, initial: opsInitial, onMerged });

  const triage = loop.state?.counts.triage ?? 0;
  const inFlight = loop.state?.counts.inFlight ?? 0;
  const stages = computeTvStages({ running: wall.running, triage, inFlight });

  const { setIdx, activeIdx, manualPaused, setManualPaused, onMouseEnter, onMouseLeave, onFocus, onBlur } =
    useTvRotation(stages.length, onExit);

  const active: TvStageId = stages[activeIdx] ?? "standing";

  const ops: OpsView = {
    state: loop.state ?? { triage: [], inFlight: [], landed: [], counts: { triage: 0, inFlight: 0, landed: 0 }, mockPrs: false },
    busy: loop.busy,
    accept: loop.accept,
    reject: loop.reject,
    onVerify,
  };
  const data: TvStageData = { slug, stats: wall.stats, leaderboard: wall.leaderboard, ticker: wall.ticker, pct: wall.pct, progress: wall.progress, deltas, trend, goal, ops };

  return (
    <div
      className="strata relative isolate min-h-[70vh] overflow-hidden rounded-3xl border border-divider bg-surface/40 p-6 md:p-8"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      // Mirror the hover-pause for keyboard/remote users: focus anywhere inside the wall holds the
      // stage; leaving the wall entirely resumes (relatedTarget check ignores intra-wall moves).
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <LiveWarRoomTvHeader
        slug={slug}
        stages={stages}
        activeIdx={activeIdx}
        onJump={setIdx}
        manualPaused={manualPaused}
        onTogglePause={() => setManualPaused((p) => !p)}
        selectedCount={selectedRepos.size}
        running={wall.running}
        onScanSelected={onScanSelected}
        onExit={onExit}
      />

      {active === "scanning" && <TvScanning data={data} />}
      {active === "decide" && <TvDecide data={data} />}
      {active === "inflight" && <TvInflight data={data} />}
      {active === "standing" && <TvStanding data={data} />}

      {loop.error && <p className="mt-4 font-mono text-sm text-orange-300">{loop.error}</p>}
    </div>
  );
}
