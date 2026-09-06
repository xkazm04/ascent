"use client";

// The offload boundary: comparison runs as a request/response exchange with an identity, a budget and
// a declared failure shape. Small inputs take the synchronous fast path; larger ones are scheduled off
// the render (a timeout stands in for a worker — the scene has no worker to spawn, and the identity,
// supersession and reaper disciplines are the same either way). A response is applied only when it
// answers the CURRENT request; the effect cleanup is the named reaper; the cache is bounded.

import { useCallback, useEffect, useRef, useState } from "react";
import { BUDGET, diffBytes, diffFields, diffLines, LEDGER_VERSION, type Alignment, type DiffResult, type Level } from "./kernel";
import { serialize, type Signal, WINDOW } from "./fixtures";

export type Request = { pairKey: string; level: Level; alignment: Alignment; base: readonly Signal[]; cand: readonly Signal[] };

export type ComparisonState =
  | { status: "idle" }
  | { status: "computing"; seq: number; path: "sync" | "scheduled" }
  | { status: "ready"; seq: number; result: DiffResult; fromCache: boolean; path: "sync" | "scheduled" }
  | { status: "failed"; seq: number; message: string };

export const CACHE_CAP = 8;

/** A content fingerprint, so an edited side misses the cache even under the same pair identity. */
function fingerprint(rows: readonly Signal[]): string {
  let h = 2166136261;
  for (const s of rows) for (const ch of `${s.id}=${s.value};`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `${rows.length}:${(h >>> 0).toString(16)}`;
}

function runKernel(req: Request): DiffResult {
  if (req.level === "fields") return diffFields(req.base, req.cand, req.alignment, WINDOW);
  const a = serialize(req.base, "a");
  const b = serialize(req.cand, "b");
  if (req.level === "bytes") return diffBytes(a, b);
  const real = diffFields(req.base, req.cand, "keyed", 0).differences;
  return diffLines(a, b, real, WINDOW);
}

export function useComparison(req: Request, { killed, forceDelayMs = 0 }: { killed: boolean; forceDelayMs?: number }) {
  const [state, setState] = useState<ComparisonState>({ status: "idle" });
  const seqRef = useRef(0);
  const cacheRef = useRef(new Map<string, DiffResult>());
  const [dropped, setDropped] = useState(0);
  const [hits, setHits] = useState(0);
  const [retries, setRetries] = useState(0);

  const n = Math.max(req.base.length, req.cand.length);
  const key = `${req.pairKey}|${req.level}|${req.alignment}|v${LEDGER_VERSION}|${fingerprint(req.base)}|${fingerprint(req.cand)}`;
  const delay = forceDelayMs > 0 ? forceDelayMs : n <= BUDGET.fastPathRows ? 0 : Math.min(600, Math.round(n / 100));

  useEffect(() => {
    const seq = ++seqRef.current;
    const cached = cacheRef.current.get(key);
    if (cached && !killed) {
      setHits((h) => h + 1);
      setState({ status: "ready", seq, result: cached, fromCache: true, path: "sync" });
      return;
    }
    const settle = () => {
      // Supersession: a response for a request the surface has moved past is dropped, never applied.
      if (seq !== seqRef.current) {
        setDropped((d) => d + 1);
        return;
      }
      if (killed) {
        // Failure is spelled as failure — a distinct shape, not an empty result.
        setState({ status: "failed", seq, message: "kernel terminated before it answered (simulated crash)" });
        return;
      }
      const result = runKernel(req);
      const cache = cacheRef.current;
      cache.set(key, result);
      // The cache names its reaper: past the cap the oldest entry leaves.
      while (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value as string);
      setState({ status: "ready", seq, result, fromCache: false, path: delay === 0 ? "sync" : "scheduled" });
    };
    if (delay === 0) {
      settle();
      return;
    }
    setState({ status: "computing", seq, path: "scheduled" });
    const timer = setTimeout(settle, delay);
    // The reaper: pair change, level change or surface teardown terminates in-flight work.
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the request identity; `req` is derived from it.
  }, [key, killed, delay, retries]);

  const retry = useCallback(() => setRetries((r) => r + 1), []);

  /** The race: a response that cannot be cancelled (a worker that already posted) lands AFTER the
   *  surface issued a newer request. Its seq no longer matches, so it is dropped and counted. */
  const race = useCallback(() => {
    const stale = seqRef.current;
    setTimeout(() => {
      if (stale !== seqRef.current) setDropped((d) => d + 1);
    }, 40);
    setRetries((r) => r + 1);
  }, []);

  return { state, dropped, hits, cacheSize: cacheRef.current.size, seq: seqRef.current, n, delay, retry, race, key };
}
