"use client";

// The run-history strip. Every past run is a button, because every past run is REPLAYABLE: its
// detail carries the same bracketing scan pair a just-finished run does, so clicking one drifts the
// field exactly as if you had watched it happen.

import { Kicker, deltaHex, fmtDelta } from "@/components/ui";
import { timeAgo } from "@/lib/ui";
import type { LoopRunSummary } from "./loopTypes";

const PHASE_TONE: Record<string, string> = {
  done: "text-slate-400",
  stopped: "text-slate-500",
  error: "text-danger",
  running: "text-accent",
  curating: "text-accent",
};

export interface CockpitHistoryProps {
  runs: LoopRunSummary[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}

export function CockpitHistory({ runs, selectedId, onOpen }: CockpitHistoryProps) {
  if (runs.length === 0) return null;
  return (
    <section aria-label="Loop run history" className="mt-4">
      <Kicker tone="muted">Runs</Kicker>
      <ul className="mt-2 flex gap-px overflow-x-auto rounded-xl border border-divider bg-divider">
        {runs.map((r) => {
          const on = r.id === selectedId;
          return (
            <li key={r.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                aria-pressed={on}
                className={`focus-ring block h-full px-4 py-2.5 text-left transition ${on ? "bg-accent/10" : "bg-ink hover:bg-surface/60"}`}
              >
                <span className="block font-mono text-xs text-slate-500">{timeAgo(r.startedAt)}</span>
                <span className="mt-0.5 block font-mono text-sm tabular-nums text-slate-300">
                  {r.repos.length} {r.repos.length === 1 ? "repo" : "repos"}
                  {r.lift != null && (
                    <span className="ml-2" style={{ color: deltaHex(r.lift) }}>
                      {fmtDelta(r.lift)}
                    </span>
                  )}
                </span>
                <span className={`mt-0.5 block font-mono text-xs uppercase tracking-[0.18em] ${PHASE_TONE[r.phase] ?? "text-slate-500"}`}>
                  {r.phase}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
