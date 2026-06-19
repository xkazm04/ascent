// Pins the per-row optimistic ROLLBACK invariant for RecommendationTracker (roadmap-recommendation-
// tracking #5b, Medium). The pure list transforms were extracted VERBATIM from the "use client"
// component into recommendationRowState.ts so they can be unit-tested without a DOM (ascent's Vitest
// has no jsdom). The load-bearing behavior: when two rows are saved concurrently and one PATCH fails,
// rolling back the failed row reverts ONLY its own status and leaves the sibling's already-confirmed
// optimistic change untouched — no whole-list snapshot clobber, no success-theater.

import { describe, it, expect } from "vitest";
import type { PersistedRecommendation, RecStatus } from "@/lib/types";
import { applyOptimisticStatus, rollbackRowStatus } from "./recommendationRowState";

/** A minimal but type-complete recommendation row at a given status. */
function rec(id: string, status: RecStatus): PersistedRecommendation {
  return {
    id,
    title: `Rec ${id}`,
    dimension: "D1",
    impact: "medium",
    effort: "medium",
    rationale: "",
    explore: [],
    status,
    assigneeLogin: null,
    targetDate: null,
  };
}

describe("applyOptimisticStatus — this-row-only optimistic update", () => {
  it("changes only the targeted row's status and leaves siblings byref-identical", () => {
    const items = [rec("a", "open"), rec("b", "open"), rec("c", "done")];
    const next = applyOptimisticStatus(items, "b", "in_progress");

    expect(next.map((i) => i.status)).toEqual(["open", "in_progress", "done"]);
    // Untouched rows are returned by REFERENCE (no needless re-render churn / no clobber).
    expect(next[0]).toBe(items[0]);
    expect(next[2]).toBe(items[2]);
    // The changed row is a fresh object (new status applied immutably).
    expect(next[1]).not.toBe(items[1]);
    expect(next[1].status).toBe("in_progress");
    // The source array is not mutated.
    expect(items[1].status).toBe("open");
  });

  it("is a no-op (every row byref-identical) when the id is not present", () => {
    const items = [rec("a", "open"), rec("b", "done")];
    const next = applyOptimisticStatus(items, "missing", "dismissed");
    expect(next.map((i) => i.status)).toEqual(["open", "done"]);
    expect(next[0]).toBe(items[0]);
    expect(next[1]).toBe(items[1]);
  });
});

describe("rollbackRowStatus — targeted per-row rollback", () => {
  it("CONCURRENT-SAVE INVARIANT: rolling back row A reverts ONLY A, leaving B's confirmed change intact", () => {
    // Start: A=open, B=open. Both rows are saved concurrently and applied optimistically:
    //   A -> done   (its PATCH will FAIL)
    //   B -> in_progress (its PATCH SUCCEEDS and is confirmed)
    const base = [rec("a", "open"), rec("b", "open")];
    const afterOptimistic = applyOptimisticStatus(applyOptimisticStatus(base, "a", "done"), "b", "in_progress");
    expect(afterOptimistic.map((i) => i.status)).toEqual(["done", "in_progress"]);

    // A's PATCH fails -> roll A back to its captured prior status ("open"). B must NOT be clobbered.
    const rolledBack = rollbackRowStatus(afterOptimistic, "a", "open");

    expect(rolledBack.find((i) => i.id === "a")!.status).toBe("open"); // A reverted to exact prior
    expect(rolledBack.find((i) => i.id === "b")!.status).toBe("in_progress"); // B's confirmed change survives
    // B's row is returned untouched (by reference) — the rollback never re-snapshotted the whole list.
    const bAfterOptimistic = afterOptimistic.find((i) => i.id === "b")!;
    expect(rolledBack.find((i) => i.id === "b")).toBe(bAfterOptimistic);
  });

  it("reverts the failed row to its EXACT captured prior status (not merely 'some prior value')", () => {
    const items = [rec("a", "in_progress")]; // prior status was in_progress, optimistic moved it to done
    const optimistic = applyOptimisticStatus(items, "a", "done");
    expect(optimistic[0].status).toBe("done");

    const rolledBack = rollbackRowStatus(optimistic, "a", "in_progress");
    expect(rolledBack[0].status).toBe("in_progress"); // exact prior, not "open" / not left at "done"
  });

  it("is a no-op when priorStatus is undefined (the row vanished before the save resolved)", () => {
    const items = [rec("a", "done"), rec("b", "open")];
    const next = rollbackRowStatus(items, "a", undefined);
    // Nothing reverts; both rows pass through by reference.
    expect(next[0]).toBe(items[0]);
    expect(next[1]).toBe(items[1]);
    expect(next.map((i) => i.status)).toEqual(["done", "open"]);
  });

  it("touches no row when the failed id is absent from the list", () => {
    const items = [rec("a", "open"), rec("b", "done")];
    const next = rollbackRowStatus(items, "missing", "open");
    expect(next[0]).toBe(items[0]);
    expect(next[1]).toBe(items[1]);
  });
});
