// markStaleRunsStopped must never stop a run this process is driving. It used to consult no
// liveness at all — every `running` row was "stale" — and the loop route calls it on every GET, so
// a page load during a run stopped the run it was rendering (found 2026-08-26 when the drive
// door's first run died 35 seconds into cycle 1 on the poll that was watching it).

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = {
  running: [] as { id: string }[],
  stoppedIds: [] as string[],
  laneUpdates: [] as unknown[],
};

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    loopRun: {
      findMany: vi.fn(async () => store.running),
      updateMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        store.stoppedIds.push(...where.id.in);
        return { count: where.id.in.length };
      }),
    },
    loopRunLane: {
      updateMany: vi.fn(async (args: unknown) => {
        store.laneUpdates.push(args);
        return { count: 0 };
      }),
    },
  }),
}));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async () => ({ id: "org-acme" })) }));

import { markStaleRunsStopped } from "@/lib/db/loop-runs-write";

beforeEach(() => {
  store.running = [{ id: "run-live" }, { id: "run-orphan" }];
  store.stoppedIds = [];
  store.laneUpdates = [];
});

describe("markStaleRunsStopped — liveness", () => {
  it("stops only the runs the predicate does not vouch for", async () => {
    const n = await markStaleRunsStopped("acme", (id) => id === "run-live");
    expect(n).toBe(1);
    expect(store.stoppedIds).toEqual(["run-orphan"]);
  });

  it("stops nothing when every running row is live — the poll-during-a-run case", async () => {
    const n = await markStaleRunsStopped("acme", () => true);
    expect(n).toBe(0);
    expect(store.stoppedIds).toEqual([]);
    expect(store.laneUpdates).toEqual([]);
  });

  it("with no predicate treats everything as orphaned — right only for the boot sweep", async () => {
    const n = await markStaleRunsStopped("acme");
    expect(n).toBe(2);
    expect(store.stoppedIds.sort()).toEqual(["run-live", "run-orphan"]);
  });
});
