"use client";

// OPEN PR FROM LANE — the one control in the cockpit whose effect leaves this machine.
//
// Everything else here is reversible on the operator's own disk: a run can be stopped, a worktree
// removed, a branch deleted. This pushes commits to a remote everyone can see, so it asks for the
// repository's name to be typed. That friction is deliberate and proportionate — it is the same
// shape a destructive-action confirm takes, for the same reason.
//
// VISIBILITY MATRIX (all four conditions, or nothing renders): the lane is `done`, it has a branch,
// it landed at least one commit, and it has no PR yet. A lane that already has one shows the link
// instead — the action is finished, and offering it again would invite a duplicate.
//
// The button appears only where the viewer can actually use it: opening a PR is owner-gated at the
// route, and a control that 403s on click is worse than one that is not there.

import { useState } from "react";
import { openLanePr } from "./loopClient";
import type { LoopLaneRecord } from "./loopTypes";

export interface LanePrActionProps {
  slug: string;
  lane: LoopLaneRecord;
  /** False for a non-owner: the route refuses them, so the control is not offered. */
  canOpen: boolean;
}

/** Whether this lane is in a state where a PR is a meaningful next step. */
export function canOpenLanePr(lane: LoopLaneRecord): boolean {
  return lane.phase === "done" && lane.branch != null && lane.commits > 0 && lane.prUrl == null;
}

export function LanePrAction({ slug, lane, canOpen }: LanePrActionProps) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(lane.prUrl);

  if (prUrl) {
    return (
      <a href={prUrl} className="focus-ring rounded font-mono text-xs text-accent hover:text-accent-soft">
        PR #{lane.prNumber ?? ""} →
      </a>
    );
  }
  if (!canOpen || !canOpenLanePr(lane)) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await openLanePr(slug, lane.runId, lane.id, confirm.trim());
      setPrUrl(res.prUrl);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open a PR for that lane.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring rounded font-mono text-xs text-accent hover:text-accent-soft"
      >
        Open PR from lane
      </button>
    );
  }

  return (
    <div className="mt-2 rounded border border-divider bg-surface-strong/60 p-2">
      <p className="text-xs leading-relaxed text-slate-400">
        This pushes <span className="font-mono text-slate-300">{lane.branch}</span> to the remote and opens a draft PR.
        Type <span className="font-mono text-slate-300">{lane.repoFullName}</span> to confirm.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-label={`Type ${lane.repoFullName} to confirm`}
          className="focus-ring min-w-0 flex-1 rounded border border-divider bg-ink px-2 py-1 font-mono text-xs text-slate-200"
        />
        <button
          type="button"
          disabled={busy || confirm.trim() !== lane.repoFullName}
          onClick={() => void submit()}
          className="focus-ring rounded border border-accent/60 px-2 py-1 font-mono text-xs text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Push and open
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="focus-ring rounded font-mono text-xs text-slate-500 hover:text-slate-300"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 font-mono text-xs text-danger">{error}</p>}
    </div>
  );
}
