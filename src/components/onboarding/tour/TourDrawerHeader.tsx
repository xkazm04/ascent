"use client";

// The drawer's header row — extracted from TourChecklist for the 300-LOC cap (pure relocation), then
// given the one thing the absorb needed: the CHANNEL SWITCH.
//
// The drawer is Ascent's single right-edge guidance channel, and it now carries two kinds of guidance:
// the derived setup checklist, and Athena. Making that a switch INSIDE the header rather than a second
// floating button is the whole point — a companion that needs its own launcher has stopped being the
// one channel and become a second one.
//
// `aria-pressed`, never `aria-expanded`: this is a two-state mode toggle, not a disclosure. (The pull
// tab outside the panel owns `aria-expanded` — it is the thing that actually opens and closes.)

import { Kicker } from "@/components/ui";
import type { DrawerPosture } from "./tasks";

const TITLE: Record<DrawerPosture, { kicker: string; title: string }> = {
  companion: { kicker: "Getting started", title: "Set up your dashboard" },
  teaching: { kicker: "Guided setup", title: "Learn this dashboard" },
  athena: { kicker: "Companion", title: "Athena" },
};

function ModeButton({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`focus-ring rounded-md px-2 py-0.5 type-label tracking-widest transition ${
        on ? "bg-accent/15 text-accent" : "text-slate-500 hover:text-slate-300"
      }`}
    >
      {label}
    </button>
  );
}

export function TourDrawerHeader({
  posture,
  progress,
  athenaAvailable,
  onMode,
  onCollapse,
}: {
  posture: DrawerPosture;
  progress: { done: number; total: number };
  /** False on the demo org, whose conversations the API refuses outright — so the switch isn't offered. */
  athenaAvailable: boolean;
  onMode: (athena: boolean) => void;
  onCollapse: () => void;
}) {
  const athena = posture === "athena";
  const copy = TITLE[posture];
  return (
    <div className="border-b border-divider px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Kicker>{copy.kicker}</Kicker>
          <h2 className="mt-1 type-body font-semibold text-white">{copy.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {!athena && progress.total > 0 && (
            <span className="type-caption tabular-nums text-slate-500">
              {progress.done}/{progress.total}
            </span>
          )}
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Hide guided setup"
            className="focus-ring rounded-md border border-slate-700 px-2 py-0.5 text-slate-400 transition hover:border-accent hover:text-white"
          >
            ▸
          </button>
        </div>
      </div>
      {athenaAvailable && (
        <div role="group" aria-label="Guidance channel" className="mt-2.5 flex items-center gap-1">
          <ModeButton label="Setup" on={!athena} onClick={() => onMode(false)} />
          <ModeButton label="Athena" on={athena} onClick={() => onMode(true)} />
        </div>
      )}
    </div>
  );
}
