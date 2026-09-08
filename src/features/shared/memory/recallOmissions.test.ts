// The recall omissions mapping — the (E) half of the /org redesign for this tab.
//
// FAILS BEFORE: the module did not exist; the budget-vs-not-recallable distinction lived only in a
// 330-character SectionHeader description, where nothing could assert it.
//
// What is pinned: a budget-bound omission is `measured` (fixable — raise the budget), the three
// retired reasons are `superseded` (kept, not deleted; no budget admits them), a filtered row is
// `not-judged` (never scored, so nothing may print a value for it), and a zero-count group never
// produces a block — BudgetPack floors block widths at 3 units, so an empty group would draw a mark
// asserting a group that is not there.

import { describe, expect, it } from "vitest";
import { INELIGIBLE_STATE, omissionStates, recallOmissions } from "./recallOmissions";
import type { IneligibleMemoryRow, RecallResponse, ScoredMemoryRow } from "./memoryRecall";

function scored(id: string): ScoredMemoryRow {
  return {
    id,
    namespace: "",
    content: "x",
    kind: "semantic",
    visibility: "shared",
    source: "",
    confidence: 1,
    tags: [],
    supersededBy: null,
    version: 1,
    accessCount: 0,
    expiresAt: null,
    origin: "hosted",
    registryPath: null,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    score: 0.5,
    ageDays: 10,
  };
}

function ineligible(id: string, reason: IneligibleMemoryRow["reason"]): IneligibleMemoryRow {
  const { score: _score, ageDays: _ageDays, ...row } = scored(id);
  return { ...row, reason };
}

function response(over: Partial<RecallResponse>): RecallResponse {
  return {
    memories: [],
    omitted: [],
    ineligible: [],
    usedChars: 0,
    charBudget: 6000,
    consideredCount: 0,
    omittedCount: 0,
    ...over,
  };
}

describe("recallOmissions", () => {
  it("draws nothing when nothing lost", () => {
    expect(recallOmissions(response({}))).toEqual([]);
  });

  it("makes a budget-bound omission `measured` — it was scored, and a bigger budget admits it", () => {
    const [block] = recallOmissions(response({ omitted: [scored("a"), scored("b")] }));
    expect(block).toMatchObject({ id: "budget", count: 2, state: "measured" });
  });

  it("keeps the three retired reasons apart as labels but one state: no budget admits them", () => {
    const blocks = recallOmissions(
      response({
        ineligible: [
          ineligible("a", "superseded"),
          ineligible("b", "archived"),
          ineligible("c", "expired"),
          ineligible("d", "expired"),
        ],
      }),
    );
    expect(blocks.map((b) => b.id)).toEqual(["superseded", "archived", "expired"]);
    expect(blocks.map((b) => b.count)).toEqual([1, 1, 2]);
    expect(new Set(blocks.map((b) => b.state))).toEqual(new Set(["superseded"]));
  });

  it("makes a FILTERED row `not-judged` — it was excluded before scoring, so it has no value", () => {
    const [block] = recallOmissions(response({ ineligible: [ineligible("a", "filtered")] }));
    expect(block?.state).toBe("not-judged");
    expect(INELIGIBLE_STATE.filtered).toBe("not-judged");
  });

  it("orders the fixable group first, then the ones no budget moves", () => {
    const blocks = recallOmissions(
      response({ omitted: [scored("a")], ineligible: [ineligible("b", "superseded")] }),
    );
    expect(blocks.map((b) => b.id)).toEqual(["budget", "superseded"]);
  });

  it("drops zero-count groups rather than drawing a floor-width block for them", () => {
    expect(recallOmissions(response({ omitted: [], ineligible: [] }))).toHaveLength(0);
  });

  it("legends only the states actually present, packed first, without repeats", () => {
    const blocks = recallOmissions(
      response({
        omitted: [scored("a")],
        ineligible: [ineligible("b", "superseded"), ineligible("c", "archived")],
      }),
    );
    expect(omissionStates(blocks)).toEqual(["measured", "superseded"]);
  });
});
