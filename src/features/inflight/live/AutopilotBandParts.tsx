"use client";

// AutopilotBand's presentation pieces: the arm/stop controls and the run ledger. Split from the
// band so each file stays inside the features-tree LOC cap; no state of its own beyond the picker.

import { useState } from "react";

/** The wire shape of a job as the autopilot route reports it (mirrors AutopilotJob in
 *  src/lib/local/autopilot.ts — that module imports prisma/node APIs and must stay server-only). */
export interface AutopilotJobView {
  repo: string;
  branch: string | null;
  phase: string;
  cycle: number;
  maxCycles: number;
  startedAt: string;
  endedAt: string | null;
  log: string[];
  closedIds: string[];
  commits: number;
  error: string | null;
}

const PHASE_LABEL: Record<string, string> = {
  starting: "Starting…",
  dispatching: "Agent working…",
  rescanning: "Rescanning…",
  done: "Done",
  stopped: "Stopped",
  error: "Failed",
};

export function AutopilotControls({
  pairedRepos,
  enabled,
  live,
  busy,
  onStart,
  onStop,
}: {
  pairedRepos: string[];
  enabled: boolean;
  live: boolean;
  busy: boolean;
  onStart: (fullName: string, maxCycles: number) => void;
  onStop: () => void;
}) {
  const [repo, setRepo] = useState(pairedRepos[0] ?? "");
  const [cycles, setCycles] = useState(3);

  if (!enabled) {
    return (
      <p className="font-mono text-xs text-slate-500">
        Disabled — set <span className="text-slate-300">ASCENT_AUTOPILOT=1</span> on this deployment to arm it.
      </p>
    );
  }
  if (live) {
    return (
      <button
        type="button"
        onClick={onStop}
        disabled={busy}
        className="focus-ring rounded-lg border border-danger/50 bg-danger/10 px-4 py-1.5 font-mono text-xs text-danger-soft transition hover:bg-danger/20 disabled:opacity-50"
      >
        Stop after this phase
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
        aria-label="Paired repository to work"
        className="focus-ring rounded-lg border border-divider bg-ink px-2 py-1.5 font-mono text-xs text-slate-200"
      >
        {pairedRepos.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <select
        value={cycles}
        onChange={(e) => setCycles(Number(e.target.value))}
        aria-label="Maximum cycles"
        className="focus-ring rounded-lg border border-divider bg-ink px-2 py-1.5 font-mono text-xs text-slate-200"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n} cycle{n === 1 ? "" : "s"}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => repo && onStart(repo, cycles)}
        disabled={busy || !repo}
        className="focus-ring rounded-lg bg-accent px-4 py-1.5 font-mono text-xs font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
      >
        {busy ? "Starting…" : "Start autopilot"}
      </button>
    </div>
  );
}

export function AutopilotLog({ job }: { job: AutopilotJobView }) {
  const running = job.endedAt == null;
  return (
    <div className="mt-3 rounded-lg border border-divider bg-ink p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
        <span className={running ? "text-accent" : job.error ? "text-danger" : "text-success-soft"}>
          {PHASE_LABEL[job.phase] ?? job.phase}
        </span>
        <span className="text-slate-400">
          {job.repo} · cycle <span className="tabular-nums text-slate-200">{job.cycle}</span>/{job.maxCycles}
        </span>
        <span className="text-slate-400">
          <span className="tabular-nums text-slate-200">{job.commits}</span> commit{job.commits === 1 ? "" : "s"} ·{" "}
          <span className="tabular-nums text-success-soft">{job.closedIds.length}</span> closed
        </span>
        {job.branch && <span className="text-slate-500">branch {job.branch}</span>}
      </div>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-400">
        {job.log.slice(-40).join("\n")}
      </pre>
    </div>
  );
}
