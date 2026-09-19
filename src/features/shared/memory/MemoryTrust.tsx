"use client";

// The trust profile of what is listed — confidence AND citation evidence, drawn.
//
// Confidence is the axis nothing in the table below can assemble; citation votes are the other half
// of that profile and used to live only as denormalized columns. A store whose agents have cited
// four notes is a different kind of knowledge than one whose confidence box is high and whose
// `citedCount` is silently zero. The two counters are never netted: a memory nobody has cited and a
// memory agents have rejected need different actions, and a single score erases that.
//
// Quartiles rather than a mean for confidence. Citation votes render as a `BudgetPack` only when at
// least one listed row carries a vote — zero votes is "no evidence", never a pack parked at 0.

import { BudgetPack, Distribution, Legend, WhyChip, type Omission } from "@/components/org/viz";
import type { MemoryRow } from "@/lib/db";

/** Nearest-rank quantile over an already-sorted array. Total: an empty array is handled by the caller. */
function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i] ?? 0;
}

function voteCount(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** Sum the two citation counters across listed rows. Null when neither has any votes — that is
 *  "no evidence", never a pair of zeros. The counters are never netted. */
export function citationEvidence(
  memories: MemoryRow[],
): { cited: number; notUseful: number } | null {
  let cited = 0;
  let notUseful = 0;
  for (const m of memories) {
    cited += voteCount(m.citedCount);
    notUseful += voteCount(m.notUsefulCount);
  }
  if (cited === 0 && notUseful === 0) return null;
  return { cited, notUseful };
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

  const evidence = citationEvidence(memories);
  const omissions: Omission[] = [];
  if (evidence && evidence.notUseful > 0) {
    omissions.push({
      id: "not-useful",
      label: "marked not useful",
      count: evidence.notUseful,
      state: "declared",
    });
  }

  return (
    <div className="mt-3 max-w-sm">
      <Distribution
        label="Confidence of the listed memories"
        min={sorted[0] ?? 0}
        q1={quantile(sorted, 0.25)}
        median={quantile(sorted, 0.5)}
        q3={quantile(sorted, 0.75)}
        max={sorted[sorted.length - 1] ?? 0}
        n={sorted.length}
        digits={2}
      />
      {evidence && (
        <>
          <BudgetPack
            className="mt-3"
            label="Citation evidence on listed memories"
            used={evidence.cited}
            budget={evidence.cited + evidence.notUseful}
            unit=" votes"
            omissions={omissions}
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {omissions.length > 0 && <Legend states={omissions.map((o) => o.state)} />}
            <WhyChip
              label="citation evidence"
              hint="A citation is an agent's self-report that it used a memory, not proof it helped, and citedCount is never netted against notUsefulCount."
            />
          </div>
        </>
      )}
    </div>
  );
}
