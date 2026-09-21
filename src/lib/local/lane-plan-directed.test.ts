// THE DIRECTED QUEUE — an approved plan is re-resolved to TODAY's rows by durable key, executes under
// its direction's fence, and is never run on a dead or spent grant.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowUpItem } from "@/lib/org/followups";
import type { LoopDirectionRecord, LoopPlanRecord } from "./runner-types";

const state = {
  plans: [] as LoopPlanRecord[],
  directions: new Map<string, LoopDirectionRecord>(),
  today: new Map<string, FollowUpItem>(),
  startOk: true,
};
const returnApprovedPlan = vi.fn(async () => true);
const supersedeApprovedPlan = vi.fn(async () => true);
const startDirectedPlan = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => state.startOk);
const exhaustDirection = vi.fn(async () => undefined);
vi.mock("@/lib/db/loop-plans", () => ({ listApprovedPlans: vi.fn(async () => state.plans) }));
vi.mock("@/lib/db/loop-plans-write", () => ({ returnApprovedPlan, supersedeApprovedPlan, startDirectedPlan }));
vi.mock("@/lib/db/loop-directions", () => ({
  getLoopDirection: vi.fn(async (id: string) => state.directions.get(id) ?? null),
  directionHasBudget: (d: LoopDirectionRecord) => d.usedCycles < d.budgetCycles && (d.budgetMicros == null || d.usedMicros < d.budgetMicros),
  exhaustDirection,
}));
vi.mock("@/lib/db/loop-plan-items", () => ({ openItemsByKey: vi.fn(async () => state.today) }));

import { nextDirectedBatch } from "./lane-plan-directed";

const T = "2026-09-18T10:00:00.000Z";
const direction = (id: string, over: Partial<LoopDirectionRecord> = {}): LoopDirectionRecord => ({
  id, orgId: "o", repo: "acme/web", title: "Split the fetch layer", fence: ["src/lib/"], checkText: "npm test",
  budgetCycles: 3, budgetMicros: null, usedCycles: 0, usedMicros: 0, status: "active", originPlanId: "p", approvedBy: "kaz",
  approvedAt: T, createdAt: T, updatedAt: T, endedAt: null, ...over,
});
const plan = (id: string, directionId: string | null, keys: string[], recIds: string[]): LoopPlanRecord => ({
  id, orgId: "o", repo: "acme/web", runId: "r", laneId: "l", directionId, itemKeys: keys, recIds, itemTitles: keys.map((k) => `As approved ${k}`),
  plan: {
    v: 1, intent: "Split fetch into its own module.", modules: ["src/lib/"], check: "npm test", risks: [], notDoing: [],
    items: recIds.map((r) => ({ recommendationId: r, approach: `approach ${r}`, files: [], moves: [{ kind: "module-created", from: null, to: "src/lib/fetch/" }] })),
  },
  planText: "", partition: { source: "directory", modules: ["src/lib/db/"] }, cls: "major", clsReason: "declared-moves",
  status: "approved", sessionId: null, heldBranch: null, decidedBy: "kaz", decidedAt: T, decisionNote: null, createdAt: T, updatedAt: T,
});
const row = (id: string, title: string): FollowUpItem => ({
  id, repo: "acme/web", title, dimId: "D1", dimLabel: "D1", impact: "high", effort: "low", rationale: "", explore: [], projectedPoints: null,
});

beforeEach(() => {
  state.plans = [];
  state.directions = new Map([["dir-1", direction("dir-1")]]);
  state.today = new Map();
  state.startOk = true;
  for (const f of [returnApprovedPlan, supersedeApprovedPlan, startDirectedPlan, exhaustDirection]) f.mockClear();
});

describe("nextDirectedBatch", () => {
  it("is null when nothing is approved", async () => {
    expect(await nextDirectedBatch("acme", "acme/web")).toBeNull();
  });

  it("re-resolves the plan's durable keys to TODAY's rows, dropping keys that no longer resolve", async () => {
    state.plans = [plan("p1", "dir-1", ["k-live", "k-gone"], ["old-1", "old-2"])];
    state.today = new Map([["k-live", row("today-1", "Split fetch")]]);
    const batch = await nextDirectedBatch("acme", "acme/web");
    expect(batch).toMatchObject({
      planId: "p1",
      directionId: "dir-1",
      items: [{ id: "today-1" }],
      directionFence: ["src/lib/"],
      declaredMoves: [{ kind: "module-created", from: null, to: "src/lib/fetch/" }],
    });
    expect(batch!.planBlock).toContain("The operator APPROVED it");
    expect(batch!.planBlock).toContain("`today-1` — Split fetch: approach old-1");
    expect(startDirectedPlan).toHaveBeenCalledWith("p1", "dir-1", ["today-1"], ["k-live"], ["As approved k-live"]);
  });

  it("supersedes a plan none of whose items is open any more, and moves on to the next", async () => {
    state.plans = [plan("p1", "dir-1", ["k-gone"], ["old-1"]), plan("p2", "dir-1", ["k-live"], ["old-2"])];
    state.today = new Map([["k-live", row("today-2", "Other")]]);
    expect((await nextDirectedBatch("acme", "acme/web"))?.planId).toBe("p2");
    expect(supersedeApprovedPlan).toHaveBeenCalledWith("p1", expect.any(String));
  });

  it("never runs a plan on an ended grant — it goes back to the operator", async () => {
    state.directions.set("dir-1", direction("dir-1", { status: "revoked" }));
    state.plans = [plan("p1", "dir-1", ["k"], ["r"])];
    state.today = new Map([["k", row("t", "x")]]);
    expect(await nextDirectedBatch("acme", "acme/web")).toBeNull();
    expect(returnApprovedPlan).toHaveBeenCalledWith("p1", expect.stringContaining("re-approval"));
    expect(startDirectedPlan).not.toHaveBeenCalled();
  });

  it("exhausts a spent direction instead of running its plan (cycles or money)", async () => {
    state.directions.set("dir-1", direction("dir-1", { usedCycles: 3 }));
    state.directions.set("dir-2", direction("dir-2", { budgetMicros: 100, usedMicros: 100 }));
    state.plans = [plan("p1", "dir-1", ["k"], ["r"]), plan("p2", "dir-2", ["k"], ["r"])];
    state.today = new Map([["k", row("t", "x")]]);
    expect(await nextDirectedBatch("acme", "acme/web")).toBeNull();
    expect(exhaustDirection.mock.calls).toEqual([["dir-1"], ["dir-2"]]);
  });

  it("loses a race gracefully: a plan another lane already took is skipped", async () => {
    state.startOk = false;
    state.plans = [plan("p1", "dir-1", ["k"], ["r"])];
    state.today = new Map([["k", row("t", "x")]]);
    expect(await nextDirectedBatch("acme", "acme/web")).toBeNull();
  });
});
