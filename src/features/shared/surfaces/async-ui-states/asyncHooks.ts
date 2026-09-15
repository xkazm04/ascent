"use client";

// The scene's request machinery as hooks. `useRequestRegion` is a simulated fetch per async region:
// state is DERIVED from it (an outstanding-request count, a sticky settled bit, the last error, the
// key the held content was produced under) — nothing at a call site sets a loading boolean by hand.
// `useSeenSet` is the surface-scoped identity set arrival choreography consults. Written against the
// React Compiler rules: no ref read during render, no clock read during render.

import { useCallback, useEffect, useRef, useState } from "react";
import { deriveState, type FailureClass, type RegionInputs, type RegionState } from "./asyncState";

export type Job<T> = { rows: T[]; latencyMs: number; fail?: FailureClass };
export type IssueOpts = {
  /** The windowing key the response will answer; held content whose key differs is superseded. */
  key?: string;
  /** An identifying change: the region is a new surface — drop content, unset settled, may ghost. */
  drop?: boolean;
  /** A label the caller reads back once this response applies (which edge the list just took). */
  tag?: string;
};

export type Region<T> = {
  content: T[];
  inFlight: boolean;
  settled: boolean;
  error: FailureClass | null;
  /** Sequence numbers: issued vs applied, and how many stale responses latest-wins dropped. */
  issued: number;
  applied: number;
  dropped: number;
  appliedKey: string;
  appliedTag: string;
  /** Seconds since the held content was applied (state advanced by an interval, never Date.now in render). */
  ageS: number;
  failures: number;
  inputs: (superseded: boolean) => RegionInputs;
  state: (superseded: boolean) => RegionState;
  /** Resolves when the response lands (applied, failed OR dropped) — a pressed control's lifetime. */
  issue: (job: Job<T>, opts?: IssueOpts) => Promise<void>;
  reset: () => void;
};

export function useRequestRegion<T>(): Region<T> {
  const [content, setContent] = useState<T[]>([]);
  const [outstanding, setOutstanding] = useState(0);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<FailureClass | null>(null);
  const [issued, setIssued] = useState(0);
  const [applied, setApplied] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [failures, setFailures] = useState(0);
  const [appliedKey, setAppliedKey] = useState("");
  const [appliedTag, setAppliedTag] = useState("");
  const [ageS, setAgeS] = useState(0);
  const latest = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);
  // Staleness clock: ticks while content is held. The restart (`ageS = 0`) is folded into the apply
  // event below, so the effect only subscribes the interval — no setState in its body.
  useEffect(() => {
    if (applied === 0) return;
    const id = setInterval(() => setAgeS((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [applied]);

  const issue = useCallback((job: Job<T>, opts: IssueOpts = {}) => {
    const seq = ++latest.current; // the token latest-wins checks
    setIssued(seq);
    if (opts.drop) {
      setContent([]);
      setSettled(false);
    }
    setError(null); // a retry clears the error when it STARTS; loading does not "win" over failure
    setOutstanding((n) => n + 1);
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        timers.current.delete(t);
        setOutstanding((n) => n - 1);
        resolve();
        if (seq !== latest.current) {
          setDropped((d) => d + 1); // a stale response for an older request: never applied
          return;
        }
        setSettled(true); // sticky: success or failure, the first completion settles the region
        setApplied(seq);
        setAgeS(0); // the staleness clock restarts on the apply edge (success or failure alike)
        setAppliedTag(opts.tag ?? "");
        if (job.fail) {
          setError(job.fail); // held content survives; the failure is admitted beside it
          setFailures((f) => f + 1);
          return;
        }
        setContent(job.rows);
        setAppliedKey(opts.key ?? "");
      }, job.latencyMs);
      timers.current.add(t);
    });
  }, []);

  const reset = useCallback(() => {
    latest.current += 1; // anything in flight is now stale
    setContent([]);
    setSettled(false);
    setError(null);
    setAppliedKey("");
    setAppliedTag("");
  }, []);

  const inFlight = outstanding > 0;
  const inputs = (superseded: boolean): RegionInputs => ({ inFlight, held: content.length, settled, error, superseded });
  return {
    content,
    inFlight,
    settled,
    error,
    issued,
    applied,
    dropped,
    appliedKey,
    appliedTag,
    ageS,
    failures,
    inputs,
    state: (superseded) => deriveState(inputs(superseded)),
    issue,
    reset,
  };
}

/**
 * Arrival choreography's guard: a SURFACE-scoped set of identities that have entered, consulted during
 * render and written when an entrance completes. It outlives the rows (a row that unmounts and remounts
 * is still seen) and resets only on an explicit call — the identifying-axis change, never a poll.
 */
export function useSeenSet() {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const has = useCallback((id: string) => seen.has(id), [seen]);
  const mark = useCallback((ids: string[]) => {
    setSeen((s) => {
      if (ids.every((id) => s.has(id))) return s;
      const next = new Set(s);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);
  const reset = useCallback(() => setSeen(new Set()), []);
  return { has, mark, reset, size: seen.size };
}
