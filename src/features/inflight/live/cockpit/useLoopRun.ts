"use client";

// The cockpit's run state machine. Owns the loop status, the ACTIVE run's lane detail, and the four
// actions; the components above it are pure renderings of what this returns.
//
// POLL DISCIPLINE, same contract as useShipLoop.ts: there is no idle timer. A tick is armed only
// while a run is actually live AND the tab is foregrounded, so a cockpit left open on a finished run
// — or on a background tab — costs exactly nothing. One tick reads BOTH the status (is there an
// active run, and what has the history strip got) and, when there is one, that run's detail: the
// status route deliberately returns the run row alone, so the lanes the run panel draws have to come
// from the detail route, and doing it in the same tick keeps the two from disagreeing on screen.
//
// SETTLEMENT. A finished run stops being `active` (the route only reports curating|running), so the
// transition is detected by the id disappearing — at which point the detail is fetched ONCE more and
// handed up. That final read is what the outcome ledger and the field's drift are both built from.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchLoopDetail,
  fetchLoopProposals,
  fetchLoopStatus,
  retryLoopLane,
  startLoop,
  stopLoop,
  type StartLoopInput,
} from "./loopClient";
import { isRunLive, type LoopProposal, type LoopRunDetail, type LoopRunRecord, type LoopRunSummary } from "./loopTypes";

const POLL_MS = 3_000;

export interface UseLoopRunInput {
  slug: string;
  initialActive: LoopRunRecord | null;
  initialRuns: LoopRunSummary[];
  initialEnabled: boolean;
  /** Fired once, with the final detail, when the active run reaches done/stopped/error. */
  onSettled?: (detail: LoopRunDetail) => void;
}

export function useLoopRun({ slug, initialActive, initialRuns, initialEnabled, onSettled }: UseLoopRunInput) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [active, setActive] = useState<LoopRunRecord | null>(initialActive);
  const [runs, setRuns] = useState<LoopRunSummary[]>(initialRuns);
  const [detail, setDetail] = useState<LoopRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const live = isRunLive(active?.phase);
  const activeId = active?.id ?? null;

  // Latest onSettled without re-arming the poll.
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);
  // The id we last saw live — the thing whose disappearance means "it finished".
  const lastLiveId = useRef<string | null>(initialActive && isRunLive(initialActive.phase) ? initialActive.id : null);

  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const tick = useCallback(async () => {
    try {
      const status = await fetchLoopStatus(slug);
      setEnabled(status.enabled);
      setActive(status.active);
      setRuns(status.runs);
      const nowId = status.active?.id ?? null;
      if (nowId) {
        setDetail(await fetchLoopDetail(slug, nowId));
        lastLiveId.current = isRunLive(status.active?.phase) ? nowId : lastLiveId.current;
      } else if (lastLiveId.current) {
        const finishedId = lastLiveId.current;
        lastLiveId.current = null;
        const final = await fetchLoopDetail(slug, finishedId);
        setDetail(final);
        settledRef.current?.(final);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    }
  }, [slug]);

  // One tick on mount (it catches a run started in another tab) and then, ONLY while a run is live
  // and the tab is foregrounded, an interval. Both are scheduled from callbacks rather than run in
  // the effect body, so the effect itself never sets state synchronously.
  useEffect(() => {
    const first = setTimeout(() => void tick(), 0);
    const t = live && visible ? setInterval(() => void tick(), POLL_MS) : null;
    return () => {
      clearTimeout(first);
      if (t) clearInterval(t);
    };
  }, [live, visible, tick]);

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const start = useCallback(
    async (input: StartLoopInput) => {
      const res = await guard(() => startLoop(slug, input));
      if (res?.run) {
        setActive(res.run);
        lastLiveId.current = res.run.id;
        void tick();
      }
      return res?.run ?? null;
    },
    [guard, slug, tick],
  );

  const stop = useCallback(
    async (id: string) => {
      await guard(() => stopLoop(slug, id));
      void tick();
    },
    [guard, slug, tick],
  );

  const retry = useCallback(
    async (laneId: string) => {
      await guard(() => retryLoopLane(slug, laneId));
      void tick();
    },
    [guard, slug, tick],
  );

  const loadDetail = useCallback(
    async (id: string): Promise<LoopRunDetail | null> => guard(() => fetchLoopDetail(slug, id)),
    [guard, slug],
  );

  const propose = useCallback(
    async (repos: readonly string[]): Promise<LoopProposal[] | null> => guard(() => fetchLoopProposals(slug, repos)),
    [guard, slug],
  );

  return { enabled, active, activeId, live, runs, detail, error, busy, start, stop, retry, loadDetail, propose, refresh: tick };
}
