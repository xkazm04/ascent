"use client";

// One run's detail (lanes with their logs, deliverables, reports, verdicts, outcomes), fetched ONCE per
// run and kept for the life of the desk: walking round → lane → log → back never refetches, and
// prev/next across rounds fetches only the round it lands on. A failed read is kept as a failure the
// page names ("could not read round #41") with a retry, never an empty document.

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLoopDetail } from "../cockpit/loopClient";
import type { LoopRunDetail } from "../cockpit/loopTypes";

export type DetailState =
  | { status: "loading" }
  | { status: "ready"; detail: LoopRunDetail }
  | { status: "failed"; error: string };

const LOADING: DetailState = { status: "loading" };

export function useRunDetail(slug: string, runId: string | null): { state: DetailState | null; retry: () => void } {
  const [store, setStore] = useState<Record<string, DetailState>>({});
  const inFlight = useRef(new Set<string>());
  const known = runId ? store[runId] : undefined;
  const need = runId != null && known == null;

  useEffect(() => {
    if (!runId || !need || inFlight.current.has(runId)) return;
    inFlight.current.add(runId);
    fetchLoopDetail(slug, runId)
      .then((detail): DetailState => ({ status: "ready", detail }))
      .catch((e: unknown): DetailState => ({ status: "failed", error: e instanceof Error ? e.message : "Could not read that run" }))
      .then((next) => {
        inFlight.current.delete(runId);
        // Kept even when the page moved on: the next visit is then instant.
        setStore((s) => ({ ...s, [runId]: next }));
      });
  }, [slug, runId, need]);

  const retry = useCallback(() => {
    if (!runId) return;
    setStore((s) => {
      const next = { ...s };
      delete next[runId];
      return next;
    });
  }, [runId]);

  if (!runId) return { state: null, retry };
  return { state: known ?? LOADING, retry };
}
