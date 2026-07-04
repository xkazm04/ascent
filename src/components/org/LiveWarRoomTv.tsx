"use client";

// Dynamic-UI TV mode orchestrator. Instead of full-screening the whole scrolling wall, this renders
// ONE lifecycle-relevant stage at a time (computeTvStages), big enough for a wall across the room,
// and rotates through the states that have something to show — while a live scan LOCKS the wall to
// the scanning stage. It owns the ship-loop poller in TV mode (the normal band is unmounted here, so
// there's never a double poller), and exits cleanly on Esc / leaving fullscreen.

import { useCallback, useEffect, useRef, useState } from "react";
import { useShipLoop } from "@/components/org/useShipLoop";
import { TV_STAGE_LABEL, clampStageIndex, computeTvStages, type TvStageId } from "@/components/org/liveTvStages";
import { TvDecide, TvInflight, TvScanning, TvStanding, type TvStageData } from "@/components/org/LiveWarRoomTvStages";
import type { OpsState } from "@/lib/db";
import type { OpsView } from "@/components/org/liveWarRoomOpsShared";
import type { GoalProgressView } from "@/components/org/plan/goalView";
import type { LiveRepo, Mover } from "@/components/org/liveWarRoomShared";

const STAGE_MS = 14_000;

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

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // Auto-rotate through the relevant stages; a single-stage state (or a running scan) never rotates.
  useEffect(() => {
    if (stages.length <= 1 || paused || !visible) return;
    const t = setInterval(() => setIdx((i) => i + 1), STAGE_MS);
    return () => clearInterval(t);
  }, [stages.length, paused, visible]);

  // Esc exits TV mode; leaving fullscreen (also Esc) exits too, so the two stay in lockstep.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
      else if (e.key === "ArrowRight") setIdx((i) => i + 1);
      else if (e.key === "ArrowLeft") setIdx((i) => i - 1);
    };
    const onFs = () => {
      if (typeof document !== "undefined" && !document.fullscreenElement) onExit();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [onExit]);

  const activeIdx = clampStageIndex(idx, stages.length);
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
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <header className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2 font-mono text-sm uppercase tracking-[0.3em] text-accent">
          <span className="live-dot inline-block h-2 w-2 rounded-full bg-red-500" aria-hidden />
          Live · {slug}
        </span>
        <span className="flex-1" />
        {/* Stage indicator: the relevant states, active highlighted, click to jump. */}
        <div className="flex flex-wrap gap-1 font-mono text-xs uppercase tracking-widest">
          {stages.map((sId, i) => (
            <button
              key={sId}
              type="button"
              onClick={() => setIdx(i)}
              className={`focus-ring rounded px-2 py-0.5 transition ${i === activeIdx ? "bg-accent/15 text-accent" : "text-slate-500 hover:text-slate-300"}`}
            >
              {TV_STAGE_LABEL[sId]}
            </button>
          ))}
        </div>
        {/* Manual retrigger — scan the repos picked on the timetable (auto-relaunch was removed). */}
        <button
          type="button"
          onClick={onScanSelected}
          disabled={selectedRepos.size === 0 || wall.running}
          title={selectedRepos.size === 0 ? "Pick repos on the wall's timetable before entering TV mode" : `Scan the ${selectedRepos.size} selected repos`}
          className="focus-ring rounded-lg bg-accent px-3 py-1 font-mono text-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          {wall.running ? "Scanning…" : `▶ Scan selected (${selectedRepos.size})`}
        </button>
        <button
          type="button"
          onClick={onExit}
          className="focus-ring rounded-lg border border-slate-700 px-3 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
        >
          Exit TV ⏏
        </button>
      </header>

      {active === "scanning" && <TvScanning data={data} />}
      {active === "decide" && <TvDecide data={data} />}
      {active === "inflight" && <TvInflight data={data} />}
      {active === "standing" && <TvStanding data={data} />}

      {loop.error && <p className="mt-4 font-mono text-sm text-orange-300">{loop.error}</p>}
    </div>
  );
}
