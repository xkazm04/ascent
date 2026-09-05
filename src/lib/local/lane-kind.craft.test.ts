// THE CRAFT LANE PROPOSAL. Sibling of lane-kind.test.ts, which pins the foundation/practice/backlog
// rules and must keep passing untouched.
//
// The rule under test is ordering: a craft lane is proposed only when the batch in hand is ALL craft
// — which is `openBatch`'s way of saying "this repo has no open gap left". A practice starter answers
// a gap, so it cannot outrank craft here: there is no gap for it to answer.

import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({ stat: vi.fn(async () => ({})) }));

import { proposeLaneKind } from "./lane-kind";
import type { FollowUpItem } from "@/lib/org/followups";
import type { CraftAxis } from "@/lib/scoring/craft";

const gap = (dimId: string): FollowUpItem => ({
  id: `g-${dimId}`,
  repo: "o/r",
  title: "a gap",
  dimId,
  dimLabel: dimId,
  impact: "high",
  effort: "low",
  rationale: "",
  explore: [],
  projectedPoints: 3,
});

const craft = (axis: CraftAxis | null): FollowUpItem => ({
  ...gap("D2"),
  id: `c-${axis ?? "none"}`,
  title: "a rung",
  projectedPoints: null,
  kind: "craft",
  craftAxis: axis,
});

/** The once-per-repo practice gate. Nothing here is about it, so every case says "none dispatched". */
const none = async (): Promise<ReadonlySet<string>> => new Set<string>();

describe("proposeLaneKind — the craft rung", () => {
  it("proposes a CRAFT lane when the batch is all craft (i.e. no open gaps left)", async () => {
    const plan = await proposeLaneKind("C:/repo", async () => [craft("performance"), craft("robustness")], none);
    expect(plan.kind).toBe("craft");
    expect(plan.practiceId).toBeNull();
    expect(plan.reason).toContain("No open gaps left");
    // The reason names the axes, so the curation screen says what the lane is about.
    expect(plan.reason).toContain("performance");
  });

  it("still proposes a backlog/practice lane when a single GAP is present", async () => {
    // A craft item alongside a gap must never flip the lane — gaps outrank craft everywhere.
    const plan = await proposeLaneKind("C:/repo", async () => [gap("D9"), craft("performance")], none);
    expect(plan.kind).not.toBe("craft");
  });

  it("falls back to BACKLOG when there is nothing at all to work", async () => {
    const plan = await proposeLaneKind("C:/repo", async () => [], none);
    expect(plan.kind).toBe("backlog");
  });

  it("names no axis when the rungs predate the axis column, rather than inventing one", async () => {
    const plan = await proposeLaneKind("C:/repo", async () => [craft(null)], none);
    expect(plan.kind).toBe("craft");
    expect(plan.reason).toBe(
      "No open gaps left — this lane works the craft ladder, raising the ceiling rather than closing a gap.",
    );
  });
});
