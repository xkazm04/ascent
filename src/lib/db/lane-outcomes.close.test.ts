// The craft-rung close at lane end (roadmap-0, challenge 2026-10-22b): a compare-and-set close, and
// the same status consequences every other close fires (close-memory on Shared Org Memory).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { applyEffects, updateMany, events, craftRows } = vi.hoisted(() => ({
  applyEffects: vi.fn(async () => ({ applied: ["close-memory"], failed: [] })),
  updateMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 1 })),
  events: [] as Record<string, unknown>[],
  craftRows: [] as { id: string; title: string; dimId: string; status: string }[],
}));

vi.mock("@/lib/db/rec-transition-effects", () => ({ applyRecTransitionEffects: applyEffects }));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async () => ({ id: "org-kiro" })) }));
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T) => fn().catch(() => fallback),
  getPrisma: () => ({
    laneItemOutcome: { upsert: async ({ create }: { create: Record<string, unknown> }) => ({ id: "o1", createdAt: new Date(), ...create }) },
    loopRunLane: { findUnique: async () => ({ verifyVerdict: "verified" }) },
    recommendation: {
      findMany: async () => craftRows,
      updateMany,
    },
    recommendationEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      },
    },
  }),
}));

import { recordLaneOutcomes } from "@/lib/db/lane-outcomes";

const input = {
  orgSlug: "kiro",
  runId: "run-1",
  laneId: "lane-1",
  repoFullName: "o/r",
  cycle: 3,
  batchIds: ["c1", "c2"],
  closedIds: [],
  report: {
    v: 1 as const,
    parsed: true,
    items: [
      { recommendationId: "c1", verdict: "resolved", reason: "built", files: [] },
      { recommendationId: "c2", verdict: "resolved", reason: "built", files: [] },
    ] as never,
    lessons: [],
  },
  now: new Date("2026-10-22T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  updateMany.mockImplementation(async () => ({ count: 1 }));
  applyEffects.mockImplementation(async () => ({ applied: ["close-memory"], failed: [] }));
  events.length = 0;
  craftRows.length = 0;
  craftRows.push(
    { id: "c1", title: "Rung one", dimId: "D3", status: "in_progress" },
    { id: "c2", title: "Rung two", dimId: "D4", status: "in_progress" },
  );
});

const craftEvents = () => events.filter((e) => e.kind === "status");

describe("closeBuiltCraftRungs (via recordLaneOutcomes)", () => {
  it("closes both rows by compare-and-set and applies a close-memory effect for each", async () => {
    await recordLaneOutcomes(input);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "c1", status: { not: "done" } }, data: { status: "done" } });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "c2", status: { not: "done" } }, data: { status: "done" } });
    expect(craftEvents()).toHaveLength(2);
    expect(applyEffects).toHaveBeenCalledTimes(2);
    expect(applyEffects).toHaveBeenCalledWith(
      { from: "in_progress", to: "done", title: "Rung one", dimension: "D3" },
      { recommendationId: "c1", orgId: "org-kiro", repoFullName: "o/r", actor: "autopilot" },
    );
  });

  it("a row that went done concurrently (count 0) writes no event and fires no effect", async () => {
    updateMany.mockImplementation(async (args: unknown) => ({ count: (args as { where: { id: string } }).where.id === "c1" ? 0 : 1 }));
    await recordLaneOutcomes(input);
    expect(craftEvents().map((e) => e.recommendationId)).toEqual(["c2"]);
    expect(applyEffects).toHaveBeenCalledTimes(1);
    expect(applyEffects).toHaveBeenCalledWith(expect.objectContaining({ title: "Rung two" }), expect.objectContaining({ recommendationId: "c2" }));
  });

  it("an effects rejection never costs the close its event", async () => {
    applyEffects.mockRejectedValue(new Error("boom"));
    await recordLaneOutcomes(input);
    expect(craftEvents()).toHaveLength(2);
  });
});
