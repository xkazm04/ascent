"use client";

// LOCAL MODE — the ledger's verify step, collapsed to one click (self-hosted deployments with ≥1
// paired repo; the server tab omits this button everywhere else). Rescans every paired repo from its
// working copy on disk, sequentially (each scan is an LLM call; parallel local scans would race the
// provider and the git worktree for no wall-clock win a human would notice at this N), then reports
// how many follow-ups the trailers closed and refreshes the ledger.
//
// This is the moment local mode exists for: commit with `Ascent-Resolves: <id>`, click this, watch
// the row close — no push, no GitHub round trip, no waiting on a schedule.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LocalRescanButton({ org, repos }: { org: string; repos: string[] }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: string | null; done: number; closed: number; errors: string[] } | null>(null);

  const run = async () => {
    let closed = 0;
    const errors: string[] = [];
    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i]!;
      setState({ busy: repo, done: i, closed, errors });
      try {
        const r = await fetch("/api/org/local/rescan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ org, fullName: repo }),
        });
        const d = (await r.json().catch(() => ({}))) as { resolvedFollowUps?: string[]; error?: string };
        if (!r.ok) errors.push(`${repo}: ${d.error ?? r.status}`);
        else closed += d.resolvedFollowUps?.length ?? 0;
      } catch {
        errors.push(`${repo}: network error`);
      }
    }
    setState({ busy: null, done: repos.length, closed, errors });
    router.refresh();
  };

  const busy = state?.busy != null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="focus-ring rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 font-mono text-xs text-white transition hover:bg-accent/20 disabled:opacity-60"
      >
        {busy
          ? `Scanning ${state!.busy} (${state!.done + 1}/${repos.length})…`
          : `Rescan ${repos.length} paired repo${repos.length === 1 ? "" : "s"} locally`}
      </button>
      {state && !busy && (
        <span className="font-mono text-xs text-slate-400">
          {state.closed > 0 ? (
            <span className="text-success-soft">{state.closed} follow-up{state.closed === 1 ? "" : "s"} closed ✓</span>
          ) : (
            "no trailers found — commit with Ascent-Resolves: <id> first"
          )}
          {state.errors.length > 0 && <span className="text-danger"> · {state.errors.join(" · ")}</span>}
        </span>
      )}
    </div>
  );
}
