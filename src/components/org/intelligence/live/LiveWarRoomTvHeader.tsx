"use client";

// The TV wall's header: live indicator + stage tabs + pause/scan/exit controls. Pulled out of
// LiveWarRoomTv.tsx to stay under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md).

import { TV_STAGE_LABEL, type TvStageId } from "./liveTvStages";

export function LiveWarRoomTvHeader({
  slug,
  stages,
  activeIdx,
  onJump,
  manualPaused,
  onTogglePause,
  selectedCount,
  running,
  onScanSelected,
  onExit,
}: {
  slug: string;
  stages: TvStageId[];
  activeIdx: number;
  onJump: (i: number) => void;
  manualPaused: boolean;
  onTogglePause: () => void;
  selectedCount: number;
  running: boolean;
  onScanSelected: () => void;
  onExit: () => void;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="flex items-center gap-2 font-mono text-sm uppercase tracking-[0.3em] text-accent">
        <span className="live-dot inline-block h-2 w-2 rounded-full bg-red-500" aria-hidden />
        Live · {slug}
      </span>
      <span className="flex-1" />
      {/* Stage indicator: the relevant states, active highlighted, click to jump. text-sm (not xs):
          this wall is "big enough for a room", and the hints live in the title for discoverability. */}
      <div
        className="flex flex-wrap gap-1 font-mono text-sm uppercase tracking-widest"
        title="Stages auto-rotate — ← / → switch stages, Space pauses"
      >
        {stages.map((sId, i) => (
          <button
            key={sId}
            type="button"
            onClick={() => onJump(i)}
            title={`Show the ${TV_STAGE_LABEL[sId]} stage (← / → switch, Space pauses rotation)`}
            className={`focus-ring rounded px-2 py-0.5 transition ${i === activeIdx ? "bg-accent/15 text-accent" : "text-slate-500 hover:text-slate-300"}`}
          >
            {TV_STAGE_LABEL[sId]}
          </button>
        ))}
      </div>
      {/* Explicit pause control (WCAG 2.2.2): auto-advancing content must be pausable by ANY user,
          not just a mouse hoverer. Space toggles it too (see useTvRotation's key handler). */}
      {stages.length > 1 && (
        <button
          type="button"
          onClick={onTogglePause}
          aria-pressed={manualPaused}
          title={manualPaused ? "Resume the stage auto-rotation (Space)" : "Pause the stage auto-rotation (Space)"}
          className="focus-ring rounded-lg border border-slate-700 px-3 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
        >
          {manualPaused ? "▶ Play" : "⏸ Pause"}
        </button>
      )}
      {/* Manual retrigger — scan the repos picked on the timetable (auto-relaunch was removed). */}
      <button
        type="button"
        onClick={onScanSelected}
        disabled={selectedCount === 0 || running}
        title={selectedCount === 0 ? "Pick repos on the wall's timetable before entering TV mode" : `Scan the ${selectedCount} selected repos`}
        className="focus-ring rounded-lg bg-accent px-3 py-1 font-mono text-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
      >
        {running ? "Scanning…" : `▶ Scan selected (${selectedCount})`}
      </button>
      <button
        type="button"
        onClick={onExit}
        className="focus-ring rounded-lg border border-slate-700 px-3 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
      >
        Exit TV ⏏
      </button>
    </header>
  );
}
