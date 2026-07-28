"use client";

// Shared client-side orchestration for POST /api/org/scan, the one endpoint that streams a scan run
// back as SSE. Two very different controls drive it — OrgScanButton (whole watched fleet, progress
// meter, continue-after-truncation) and RepoRescanButton (one repo, one credit, inline outcome) —
// and both had hand-rolled copies of the same four steps: POST the JSON scope, read a pre-stream
// refusal out of the JSON error body, drain the SSE frames, and treat a thrown fetch/read as a
// network error.
//
// Only that transport envelope lives here. Every component-specific decision — request scope, which
// events matter, how outcomes are worded, when to router.refresh() — stays with the caller, because
// the two controls genuinely disagree on all of them (see the callbacks below). This is deliberately
// NOT a state container: each caller keeps its own state shape, so the exact sequence and batching
// of its setState calls is unchanged.

import { useCallback } from "react";
import { readSSE, type SSEMessage } from "@/lib/sse";

/** JSON body the route returns when it refuses BEFORE opening the stream (e.g. the 402 credit gate). */
export interface ScanRefusal {
  error?: string;
  code?: string;
}

export interface ScanStreamRun {
  /** JSON request body — `{ org }` plus whatever scope the caller wants (`repos`, `staleOnlyDays`). */
  body: Record<string, unknown>;
  /** Non-2xx (or body-less) response: the parsed error JSON, or null when it wasn't JSON. */
  onRefused: (refusal: ScanRefusal | null, status: number) => void;
  /** Every non-empty SSE frame, in arrival order. Payloads are open records — unknown fields
   *  (e.g. the `charged` flag on a repo error frame) are simply ignored by the callers. */
  onMessage: (msg: SSEMessage) => void;
  /** The stream closed normally (including after an in-band `error` frame — the transport succeeded). */
  onStreamEnd: () => void;
  /** fetch/read threw — no usable response. */
  onNetworkError: () => void;
  /** Runs after every path above (success, refusal, or throw), like the caller's own `finally`. */
  onSettled?: () => void;
}

/**
 * Returns a stable `startScan(run)` that performs one scan request end to end.
 *
 * Lifecycle note: the request lives exactly as long as the promise this returns. There is no
 * subscription to leak and no reconnect — `readSSE` drains the response body once and resolves when
 * the server closes it, which is the behaviour both callers were written against.
 */
export function useScanStream() {
  return useCallback(async (run: ScanStreamRun): Promise<void> => {
    try {
      const res = await fetch("/api/org/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(run.body),
      });
      if (!res.ok || !res.body) {
        const d = (await res.json().catch(() => null)) as ScanRefusal | null;
        run.onRefused(d, res.status);
        return;
      }
      await readSSE(res.body, run.onMessage);
      run.onStreamEnd();
    } catch {
      run.onNetworkError();
    } finally {
      run.onSettled?.();
    }
  }, []);
}
