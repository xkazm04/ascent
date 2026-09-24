"use client";

// THE REMOTE-AGENT ARM on the two cloud setup cards (backlog develop-2026-09-17 row 29). Both cards
// used to DESCRIBE this run ("arm one through the API or an MCP work client") while the deployment's
// own `POST /api/org/loop` already accepted it, so a cloud owner could read about the run on the page
// and had to leave it to start one. The button arms exactly that run over the chart's selection.
//
// WHAT IT IS NOT. It is not the local Run: nothing spawns on this server, no worktree opens, and the
// lanes sit queued until an agent the org runs claims them. The caption says so, because a run that
// waits for a claimant would otherwise read as a run that hung. It is offered only where the caller's
// `canArmRemote` holds (an owner, repos to scope to); the drive and the gear stay local-only.

export interface RemoteArm {
  /** Selected repos the run would cover. Zero disables the button and says why. */
  repos: number;
  onArm: () => void;
  busy: boolean;
  /** A refused arm's own message (the route's 409, e.g. a run already active), shown under the button. */
  error: string | null;
}

export function CockpitRemoteArm({ repos, onArm, busy, error }: RemoteArm) {
  return (
    <div className="mt-3">
      <button
        type="button"
        data-testid="remote-arm-cta"
        onClick={onArm}
        disabled={busy || repos === 0}
        className="focus-ring w-full rounded-md border border-accent/60 px-3 py-2 type-label tracking-[0.18em] text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {repos === 0 ? "Select repos on the chart to arm a remote run" : `Arm remote run (${repos} ${repos === 1 ? "repo" : "repos"})`}
      </button>
      <p className="mt-1.5 type-note leading-relaxed text-slate-500">
        Nothing runs on this server. The lanes wait for an agent you run to claim them through the API or an MCP
        work client, and then render here like any other run.
      </p>
      {error && <p className="mt-2 type-caption text-danger">{error}</p>}
    </div>
  );
}
