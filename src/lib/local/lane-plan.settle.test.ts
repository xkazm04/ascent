// THE LANE'S SETTLE-UP SEAMS — an executed plan that never reached the fence is closed as `failed`
// (never `landed`), and a lane's cost is charged to the direction its plan ran under. Both never throw.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ settled: [] as unknown[][], charged: [] as unknown[][], plan: null as { directionId: string | null } | null, fail: false }));
vi.mock("@/lib/db/loop-plans-write", () => ({
  settleExecutingPlan: vi.fn(async (...a: unknown[]) => {
    if (h.fail) throw new Error("db down");
    h.settled.push(a);
    return true;
  }),
}));
vi.mock("@/lib/db/loop-plans", () => ({ getLoopPlan: vi.fn(async () => h.plan) }));
vi.mock("@/lib/db/loop-directions", () => ({ chargeDirectionMicros: vi.fn(async (...a: unknown[]) => void h.charged.push(a)) }));

import { chargeLanePlanCost, settleLanePlan } from "./lane-plan";

beforeEach(() => {
  Object.assign(h, { settled: [], charged: [], plan: null, fail: false });
});

describe("settleLanePlan", () => {
  it("closes an executing plan as failed, and is a no-op without a plan", async () => {
    await settleLanePlan("p1");
    await settleLanePlan(null);
    expect(h.settled).toEqual([["p1", "failed"]]);
  });

  it("never throws", async () => {
    h.fail = true;
    await expect(settleLanePlan("p1")).resolves.toBeUndefined();
  });
});

describe("chargeLanePlanCost", () => {
  it("charges the plan's direction, and nothing for a plan outside one or an unmetered lane", async () => {
    h.plan = { directionId: "dir-1" };
    await chargeLanePlanCost("p1", 4_200);
    await chargeLanePlanCost("p1", null);
    h.plan = { directionId: null };
    await chargeLanePlanCost("p2", 999);
    expect(h.charged).toEqual([["dir-1", 4_200]]);
  });
});
