// The client contract for the Shared Org Memory `recall` verb (/api/org/memory/recall). Types plus one
// fetch helper, declared once and shared by MemoryRecallPanel and its rows — the same split
// memoryCheck.ts and memoryReflect.ts use. No React, no server imports at runtime.
//
// `score` and `ageDays` are SERVER-COMPUTED and rendered verbatim. Re-deriving them in the browser
// would fork the value model: the core is pure precisely so that the number a user sees is the number
// that ranked the row, computed from one injected clock.

import type { MemoryRow } from "@/lib/db";

export interface ScoredMemoryRow extends MemoryRow {
  /** confidence × 0.5^(ageDays/halfLife(kind)) × (1 + 0.25·ln(1+accessCount)), at the server's clock. */
  score: number;
  ageDays: number;
}

/** Why a memory the store holds never reached the packed set. Budget is fixable; the rest are not. */
export type IneligibleReason = "superseded" | "archived" | "expired" | "filtered";

export interface IneligibleMemoryRow extends MemoryRow {
  reason: IneligibleReason;
}

export interface RecallResponse {
  /** What was packed, strongest first. */
  memories: ScoredMemoryRow[];
  /** Scored but budget-bound, strongest first. Raising the budget is what admits these. */
  omitted: ScoredMemoryRow[];
  /** Present in the store but not recallable. No budget admits these. */
  ineligible: IneligibleMemoryRow[];
  usedChars: number;
  charBudget: number;
  consideredCount: number;
  omittedCount: number;
}

export const INELIGIBLE_COPY: Record<IneligibleReason, string> = {
  superseded: "replaced by a correction",
  archived: "archived",
  expired: "past its TTL",
  filtered: "excluded by the kind/namespace filter",
};

export interface RecallQuery {
  org: string;
  namespace?: string;
  kinds?: string[];
  charBudget: number;
}

/**
 * Run a recall. NOTE the side effect this shares with every other caller of the route: the memories
 * that were actually PACKED get their `accessCount` bumped, because they reached a reader. That is the
 * value model's usage term working as designed — but it means this panel is a real recall, not a
 * preview, and the UI says so.
 */
export async function runRecall(query: RecallQuery, signal?: AbortSignal): Promise<RecallResponse> {
  const res = await fetch("/api/org/memory/recall", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(query),
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Recall failed.");
  }
  return (await res.json()) as RecallResponse;
}
