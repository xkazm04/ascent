"use client";

// The war-room's launch lifecycle, split out of useLiveWarRoom.ts for the 200-LOC src/features cap:
// POST /api/org/scan and fold its SSE stream into the wall's state. Scanning is explicit (a manual
// launch of the selected repos) — the old unattended 15-min auto-relaunch was removed so a forgotten
// wall can't silently burn prepaid credits. Every piece of state still lives in the hook; the setters
// arrive here as a context bag so this stays a plain async function with no hooks of its own.

import type { Dispatch, RefObject, SetStateAction } from "react";
import { readSSE } from "@/lib/sse";
import type { Celebration, Mover, Phase } from "@/components/org/shared/liveWarRoomShared";

export type LiveProgress = { done: number; total: number; current: string };

export type LiveScanContext = {
  slug: string;
  watchedCount: number;
  scanRepos?: string[];
  abortRef: RefObject<AbortController | null>;
  onRepo: (d: Record<string, unknown>) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setSkipped: Dispatch<SetStateAction<number>>;
  setTicker: Dispatch<SetStateAction<Mover[]>>;
  setCelebrations: Dispatch<SetStateAction<Celebration[]>>;
  setPhase: Dispatch<SetStateAction<Phase>>;
  setProgress: Dispatch<SetStateAction<LiveProgress>>;
};

export async function runLiveScan(ctx: LiveScanContext, reposOverride?: string[]) {
  const { slug, watchedCount, scanRepos, abortRef, onRepo } = ctx;
  const { setError, setSkipped, setTicker, setCelebrations, setPhase, setProgress } = ctx;
  if (abortRef.current) return; // already running
  // The ship loop's verify rescan passes an explicit repo list; otherwise the active stack's
  // scope (or the whole watched fleet) applies as before.
  const targetRepos = reposOverride ?? scanRepos;
  setError(null);
  setSkipped(0);
  setTicker([]);
  setCelebrations([]);
  setPhase("running");
  setProgress({ done: 0, total: targetRepos?.length || watchedCount, current: "starting…" });
  const ctrl = new AbortController();
  abortRef.current = ctrl;
  let sawError = false;
  try {
    const res = await fetch("/api/org/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(targetRepos && targetRepos.length > 0 ? { org: slug, repos: targetRepos } : { org: slug }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const d = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(d?.error ?? `Failed (${res.status}).`);
      setPhase("error");
      return;
    }
    await readSSE(res.body, ({ event, data }) => {
      if (!data) return;
      if (event === "progress")
        setProgress({ done: Number(data.index) || 0, total: Number(data.total) || watchedCount, current: String(data.repo ?? "") });
      else if (event === "repo") onRepo(data);
      else if (event === "notice") {
        // Up-front partial coverage: the prepaid balance can't cover every watched repo, so the
        // server is scanning a slice and skipping the rest. Count the skips and shrink the
        // denominator to what will actually run.
        const skippedN = Number(data.skipped);
        if (Number.isFinite(skippedN) && skippedN > 0) setSkipped((n) => n + skippedN);
        const scanning = Number(data.scanning);
        if (Number.isFinite(scanning) && scanning > 0) setProgress((p) => ({ ...p, total: scanning }));
      } else if (event === "result") {
        // Final summary — its skippedForCredits is authoritative (up-front slice + mid-run
        // reservation losses), so prefer it over our incremental count.
        const skippedN = Number(data.skippedForCredits);
        if (Number.isFinite(skippedN)) setSkipped(skippedN);
      } else if (event === "error") {
        sawError = true;
        setError(String(data.error));
      }
    });
    if (!ctrl.signal.aborted) {
      setProgress((p) => ({ ...p, current: "" }));
      setPhase(sawError ? "error" : "done");
    }
  } catch {
    if (ctrl.signal.aborted) {
      setPhase("idle");
      return;
    }
    setError("Network error.");
    setPhase("error");
  } finally {
    abortRef.current = null;
  }
}
