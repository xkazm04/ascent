"use client";

// RE-ATTACH to an import that is still running server-side (Direction 8).
//
// The import stream is not the run. `mapPool` inside /api/org/import is not tied to the request
// signal, so when the browser goes away — a refresh, an auth bounce, a closed tab — the scan keeps
// going, keeps persisting, and keeps spending credits. The wizard's resume snapshot used to force
// every rehydrate back to the SELECT step, so the user landed on a repo picker with no sign that
// their run was alive, and the only thing to do was start it again: the same repos, scanned twice,
// charged twice.
//
// The run now announces its `runId` on the stream's opening `queued` frame, the snapshot stores it,
// and this hook follows the run through the existing, already-gated read side —
// GET /api/org/scan/queue?org=&runId= — exactly as useOrgScanButton polls a budget-stopped bulk scan.
// Read-only, one small query per tick, stops the moment nothing is pending.

import { useEffect, useRef, useState } from "react";
import type { ScanRow } from "@/components/onboarding/OnboardingScanRow";

/** Same cadence as useOrgScanButton's queue poll. Slow on purpose: the work is durable, the next
 *  worker pass is minutes away, and a tighter poll would buy nothing and cost a query per tick. */
export const REATTACH_POLL_MS = 15_000;

export type ReattachStatus =
  /** Not re-attached (a normal run, or nothing to follow). */
  | "off"
  /** Following the run: the queue still reports unsettled jobs. */
  | "polling"
  /** Every job settled — the caller has been handed the final rows. */
  | "settled"
  /** The run cannot be followed from here (no database, no access, a failing endpoint). The rows are
   *  unknown, and saying so is the honest surface; the dashboard is the recovery. */
  | "unavailable";

export interface ReattachState {
  status: ReattachStatus;
  pending: number;
  total: number;
}

interface QueueJob {
  repo: string;
  state: string;
}

/** One queue job row → the wizard's row state. The queue endpoint reports job STATE only (no score:
 *  it is the scheduler's view, not the report's), so a finished repo is rendered as "scanned, open
 *  the report" rather than with a fabricated level. A failed job carries no reason on this endpoint
 *  either, and a skipped one carries no cause — both say exactly that much and nothing more. */
export function rowFromJob(job: QueueJob): ScanRow | null {
  switch (job.state) {
    case "done":
      return { repo: job.repo, completed: true };
    case "failed":
      return { repo: job.repo, error: "Scan failed. Open the report to see why." };
    case "skipped":
      return { repo: job.repo, skipped: "not_scanned" };
    default:
      return null; // queued / claimed — still in flight
  }
}

/**
 * Poll one import run to completion.
 *
 * `active` is the whole switch: it is true only for a rehydrated snapshot whose phase was "scanning"
 * and which carried a runId. On every tick the caller's rows are updated from the job states; when
 * nothing is pending (or the run has no jobs left to report at all) `onSettled` fires ONCE and the
 * status becomes "settled", which is the caller's cue to show the done screen.
 */
export function useImportReattach({
  active,
  org,
  runId,
  onRows,
  onSettled,
}: {
  active: boolean;
  org: string;
  runId: string | null;
  /** Fold this tick's job states into the wizard's rows. */
  onRows: (rows: ScanRow[]) => void;
  /** Every job settled — the run is over. Fired at most once per run. */
  onSettled: () => void;
}): ReattachState {
  const [state, setState] = useState<ReattachState>({ status: "off", pending: 0, total: 0 });
  // The callbacks are re-created every render by design (they close over setState in the flow hook);
  // hold them in refs so the poll interval isn't torn down and re-armed on each of those renders.
  const onRowsRef = useRef(onRows);
  const onSettledRef = useRef(onSettled);
  // Written in an effect, not during render (react-hooks/refs): the latest callbacks are what the
  // NEXT tick reads, and a tick never runs during render.
  useEffect(() => {
    onRowsRef.current = onRows;
    onSettledRef.current = onSettled;
  });

  useEffect(() => {
    if (!active || !runId || !org) {
      // A run that SETTLED keeps saying so: `active` goes false the moment the phase turns "done", and
      // wiping the status there would erase the fact that this done screen came from a re-attach. It
      // clears when the run handle itself is dropped (resetRun / a new scan).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot latch when the follow is switched off
      setState((s) => {
        if (s.status === "off") return s;
        if (s.status === "settled" && runId) return s;
        return { status: "off", pending: 0, total: 0 };
      });
      return;
    }
    let cancelled = false;
    let settled = false;
    setState({ status: "polling", pending: 0, total: 0 });

    const tick = async () => {
      let data: { pending?: number; total?: number; repos?: QueueJob[] };
      try {
        const res = await fetch(
          `/api/org/scan/queue?org=${encodeURIComponent(org)}&runId=${encodeURIComponent(runId)}`,
        );
        if (cancelled) return;
        if (!res.ok) {
          // A refusal (no database, no access) is terminal for the FOLLOW, not evidence about the run.
          // Stop polling and say the run can't be followed — never "finished".
          setState((s) => ({ ...s, status: "unavailable" }));
          return;
        }
        data = (await res.json()) as { pending?: number; total?: number; repos?: QueueJob[] };
      } catch {
        // A network blip is not information: keep the last known state and try again next tick.
        return;
      }
      if (cancelled || settled) return;
      const jobs = Array.isArray(data.repos) ? data.repos : [];
      const rows = jobs.map(rowFromJob).filter((r): r is ScanRow => r !== null);
      if (rows.length) onRowsRef.current(rows);
      const total = typeof data.total === "number" ? data.total : jobs.length;
      const pending = typeof data.pending === "number" ? data.pending : 0;
      setState({ status: "polling", pending, total });
      if (pending === 0) {
        // Nothing left in flight. `total === 0` lands here too: the run left no readable jobs (an old
        // run whose rows aged out), which is still "not running", and the caller resolves its unknown
        // rows honestly rather than waiting forever on a run nobody can see.
        settled = true;
        setState({ status: "settled", pending: 0, total });
        onSettledRef.current();
      }
    };

    void tick(); // answer immediately — a settled run must not hold the user for a full interval
    const id = setInterval(() => void tick(), REATTACH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, org, runId]);

  return state;
}
