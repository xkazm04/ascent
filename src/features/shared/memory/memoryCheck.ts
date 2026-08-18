// The client contract for the Shared Org Memory write-intelligence pass (/api/org/memory/check).
// Shared by MemoryPanel (which owns the state) and MemoryPanel.CheckVerdict (which renders it), so the
// response shape is declared once. Types only + one fetch helper — no React, no server imports at
// runtime (`import type` is erased, so pulling MemoryRow from the db barrel never ships Prisma).

import type { MemoryRow } from "@/lib/db";
import type { MemoryEngine, MemoryRecommendation, MemoryRelation } from "@/lib/memory/consolidation";

/** One candidate the pass flagged, joined to the row it refers to so the UI can show WHAT it matched. */
export interface CheckMatch {
  id: string;
  similarity: number;
  relation: MemoryRelation;
  reason: string;
  memory: MemoryRow;
}

export interface CheckResponse {
  recommendation: MemoryRecommendation;
  duplicates: CheckMatch[];
  summary?: string;
  /** True when the verdict is the deterministic token-overlap fallback, not a model's judgment. */
  llmUnavailable: boolean;
  /** Which provider judged it (`gemini`, `bedrock`, `claude-cli`, …), or the deterministic fallback. */
  engine: MemoryEngine;
  /** How many of the org's memories were actually compared — so the UI never implies a full scan. */
  comparedCount: number;
}

/**
 * Run the duplicate/consolidation check. The caller owns an AbortController so navigating away (or
 * hitting Cancel) kills the spawned CLI rather than leaving it running to completion — the route
 * forwards `request.signal` down to the child process.
 */
export async function runMemoryCheck(
  input: { org: string; content: string; kind: string; namespace?: string },
  signal?: AbortSignal,
): Promise<CheckResponse> {
  const res = await fetch("/api/org/memory/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "The duplicate check failed.");
  }
  return (await res.json()) as CheckResponse;
}

/** Headline for the verdict banner. Deliberately advisory — the author always decides. */
export function recommendationCopy(r: MemoryRecommendation, count: number): string {
  if (r === "duplicate") return "This looks like something you already know.";
  if (r === "supersede") return "This looks like a correction of an existing memory.";
  return count > 0 ? "Nothing conflicting; related memories shown below." : "This looks new.";
}

/** Badge text for how a candidate relates to the proposed memory. */
export const RELATION_LABEL: Record<MemoryRelation, string> = {
  duplicate: "duplicate",
  refines: "refines",
  contradicts: "contradicts",
  unrelated: "related",
};
