"use client";

// The confidence profile of what is listed — the store's trust axis, drawn.
//
// `MemoryPanel` used to open with a paragraph naming what a memory IS. That is onboarding copy and it
// now lives in the empty state. What a populated store actually needs first is the axis nothing in the
// table below can assemble: recall ranks on confidence × decay × delivery, and a store whose median
// confidence is 0.3 hands agents a very different kind of knowledge than one at 1.0 — a fact no row
// reveals and no sentence above the table asserted.
//
// Quartiles rather than a mean: a bimodal store (verified decisions plus a pile of hunches) has a
// perfectly ordinary mean and a very informative box. `Distribution` is the kit component for exactly
// this; nothing here re-implements a scale.

import { Distribution } from "@/components/org/viz";
import type { MemoryRow } from "@/lib/db";

/** Nearest-rank quantile over an already-sorted array. Total: an empty array is handled by the caller. */
function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i] ?? 0;
}

export function MemoryTrust({
  memories,
  loading = false,
}: {
  memories: MemoryRow[];
  loading?: boolean;
}) {
  // Nothing to plot is not a distribution of zeros — render no instrument at all rather than a box
  // parked at 0, which would read as "this org is certain of nothing".
  if (loading || memories.length === 0) return null;

  const sorted = memories
    .map((m) => m.confidence)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  return (
    <Distribution
      className="mt-3 max-w-sm"
      label="Confidence of the listed memories"
      min={sorted[0] ?? 0}
      q1={quantile(sorted, 0.25)}
      median={quantile(sorted, 0.5)}
      q3={quantile(sorted, 0.75)}
      max={sorted[sorted.length - 1] ?? 0}
      n={sorted.length}
      digits={2}
    />
  );
}
