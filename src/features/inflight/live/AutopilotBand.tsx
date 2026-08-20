"use client";

// The war room's LOCAL-MODE autopilot band (self-hosted with ≥1 paired repo; the server tab omits
// this component everywhere else). Arms dispatch cycles against ONE paired repo: a local claude
// session works the repo's top follow-ups in an isolated worktree, a from-disk rescan closes what
// its trailers resolved, and the loop repeats while progress lands. This band is the cockpit —
// picker, cycle count, start/stop, and the live log — over the job the server runs; all state of
// record lives server-side (the poll below just renders it).
//
// Poll cadence is 4s ONLY while a job is live: an agent session runs minutes, but the log lines and
// phase flips are what make the wall feel alive; when nothing runs the band is inert (no timer).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AutopilotControls, AutopilotLog, type AutopilotJobView } from "./AutopilotBandParts";

interface PollPayload {
  enabled?: boolean;
  job?: AutopilotJobView | null;
  error?: string;
}

export function AutopilotBand({ org, pairedRepos, enabled }: { org: string; pairedRepos: string[]; enabled: boolean }) {
  const router = useRouter();
  const [job, setJob] = useState<AutopilotJobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = job != null && job.endedAt == null;
  // One ledger refresh per finished run — the wall's standing tiles and the Follow-ups count should
  // reflect what the run closed, but refreshing on every poll tick would thrash server components.
  const refreshedFor = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/org/local/autopilot?org=${encodeURIComponent(org)}`, { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as PollPayload;
      if (r.ok) setJob(d.job ?? null);
    } catch {
      /* transient — the next tick retries */
    }
  }, [org]);

  useEffect(() => {
    void poll(); // catch a run started in another tab / before this mount
  }, [poll]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void poll(), 4_000);
    return () => clearInterval(t);
  }, [live, poll]);

  useEffect(() => {
    if (job?.endedAt && refreshedFor.current !== job.startedAt) {
      refreshedFor.current = job.startedAt;
      router.refresh();
    }
  }, [job?.endedAt, job?.startedAt, router]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/org/local/autopilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, ...body }),
      });
      const d = (await r.json().catch(() => ({}))) as PollPayload;
      if (!r.ok) setError(d.error ?? `Failed (${r.status}).`);
      if (d.job) setJob(d.job);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Local autopilot" className="rounded-xl border border-divider bg-surface/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-mono text-xs uppercase tracking-[0.25em] text-accent">Autopilot · local</span>
          <p className="mt-1 text-sm text-slate-400">
            Dispatch a local agent at a paired repo's follow-ups — it works an isolated branch, and a from-disk rescan
            closes what its trailers resolved. Nothing is ever pushed; you review and merge the branch.
          </p>
        </div>
        <AutopilotControls
          pairedRepos={pairedRepos}
          enabled={enabled}
          live={live}
          busy={busy}
          onStart={(fullName, maxCycles) => void act({ action: "start", fullName, maxCycles })}
          onStop={() => void act({ action: "stop" })}
        />
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {job && <AutopilotLog job={job} />}
    </section>
  );
}
