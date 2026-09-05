// Pure list transforms behind RecommendationTracker's per-row optimistic save. Extracted from the
// "use client" component so they can be unit-tested without a DOM (ascent's Vitest has no jsdom):
// the targeted-rollback invariant — a failed PATCH reverts ONLY its own row, leaving every
// concurrently-changed sibling untouched — is the load-bearing behavior and lives here verbatim.

import type { PersistedRecommendation, RecStatus } from "@/lib/types";

/** Optimistically set one row's status, this row only — siblings are returned by reference. */
export function applyOptimisticStatus(
  items: PersistedRecommendation[],
  id: string,
  status: RecStatus,
): PersistedRecommendation[] {
  return items.map((i) => (i.id === id ? { ...i, status } : i));
}

/**
 * Roll a single row back to its captured prior status — the targeted rollback. Reverting to a
 * whole-list snapshot (the old `setItems(prev)`) would clobber other rows' concurrent optimistic
 * or already-confirmed changes when several updates overlap; this touches only `id`. A null/undefined
 * `priorStatus` (the row vanished before the save resolved) is a no-op for every row.
 */
export function rollbackRowStatus(
  items: PersistedRecommendation[],
  id: string,
  priorStatus: RecStatus | undefined,
): PersistedRecommendation[] {
  return items.map((i) => (i.id === id && priorStatus !== undefined ? { ...i, status: priorStatus } : i));
}
