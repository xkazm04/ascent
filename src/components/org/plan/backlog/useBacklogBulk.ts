"use client";

// The backlog's bulk-action runner (G7-12). Multi-select + one status write per selected row, fanned
// out with bounded concurrency and followed by exactly ONE backlog re-read.
//
// BOUNDS, and why they're here rather than "as many as you picked":
//   * MAX_BULK (100) caps one action. These are DB status writes on Ascent's own rows — not customer-
//     repo writes — so the bound exists to keep a mis-click survivable and the request burst small,
//     not because a write is destructive. The selection helpers cap at the same number, and `run`
//     re-applies the slice defensively so a raw caller can't exceed it either.
//   * BULK_CONCURRENCY (4) matches SCAN_CONCURRENCY: the panel is talking to its own API, and a
//     100-wide burst would just queue in the browser anyway.
// A per-row failure never aborts the rest; the count of failures is reported, and the single refresh
// at the end re-reads authoritative state so partial success is visible rather than guessed.

import { useCallback, useState } from "react";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";

/** Rows one bulk action may touch. */
export const MAX_BULK = 100;

export const BULK_CONCURRENCY = SCAN_CONCURRENCY;

export interface BulkState {
  running: boolean;
  /** Rows attempted in the last (or current) run. */
  total: number;
  /** Rows whose PATCH returned 2xx. */
  ok: number;
  /** Rows whose PATCH failed. */
  failed: number;
}

const IDLE: BulkState = { running: false, total: 0, ok: 0, failed: 0 };

export function useBacklogBulk(refresh: () => Promise<boolean>) {
  const [state, setState] = useState<BulkState>(IDLE);

  const run = useCallback(
    async (ids: readonly string[], body: Record<string, unknown>): Promise<BulkState> => {
      const batch = ids.slice(0, MAX_BULK);
      if (batch.length === 0) return IDLE;
      setState({ running: true, total: batch.length, ok: 0, failed: 0 });
      const outcomes = await mapPool(batch, BULK_CONCURRENCY, async (id) => {
        try {
          const res = await fetch(`/api/recommendations/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          return res.ok;
        } catch {
          return false;
        }
      });
      const ok = outcomes.filter(Boolean).length;
      const next: BulkState = { running: false, total: batch.length, ok, failed: batch.length - ok };
      // One re-read for the whole run — per-row refreshes would be N round-trips racing each other,
      // which is the exact lost-update the panel's refresh sequencing exists to prevent.
      await refresh();
      setState(next);
      return next;
    },
    [refresh],
  );

  const reset = useCallback(() => setState(IDLE), []);

  return { bulk: state, runBulk: run, resetBulk: reset };
}
