// markStaleRunsStopped must never stop a run this process is driving. It used to consult no
// liveness at all — every `running` row was "stale" — and the loop route calls it on every GET, so
// a page load during a run stopped the run it was rendering (found 2026-08-26 when the drive
// door's first run died 35 seconds into cycle 1 on the poll that was watching it).

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = {
  running: [] as { id: string }[],
  stoppedIds: [] as string[],
  laneUpdates: [] as unknown[],
  /** In-flight lanes of the stale runs, with their claimed batch ids. */
  lanes: [] as { batchIdsJson: string }[],
  /** Recommendations currently in_progress (the claims a dead run left behind). */
  claimedRecs: [] as { id: string }[],
  releasedIds: [] as string[],
  releaseEvents: [] as unknown[],
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
      findMany: vi.fn(async () => store.lanes),
      updateMany: vi.fn(async (args: unknown) => {
        store.laneUpdates.push(args);
        return { count: 0 };
      }),
    },
    recommendation: {
      findMany: vi.fn(async () => store.claimedRecs),
      updateMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        store.releasedIds.push(...where.id.in);
        return { count: where.id.in.length };
      }),
    },
    recommendationEvent: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        store.releaseEvents.push(...data);
        return { count: data.length };
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
  store.lanes = [];
  store.claimedRecs = [];
  store.releasedIds = [];
  store.releaseEvents = [];
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

  it("releases the dead runs' claims — a zombie in_progress row is nobody's promise", async () => {
    // Drive #1 (2026-08-26): the killed run's lanes had claimed ten rows; the next drive found an
    // empty backlog on a fleet with 350 points of debt.
    store.lanes = [{ batchIdsJson: JSON.stringify(["rec-1", "rec-2"]) }, { batchIdsJson: "not json" }];
    store.claimedRecs = [{ id: "rec-1" }, { id: "rec-2" }];
    await markStaleRunsStopped("acme", (id) => id === "run-live");
    expect(store.releasedIds.sort()).toEqual(["rec-1", "rec-2"]);
    expect(store.releaseEvents).toHaveLength(2);
    expect(String((store.releaseEvents[0] as { note: string }).note)).toMatch(/interrupted before its rescan/);
  });

  it("releases nothing when the claimed rows are no longer in_progress", async () => {
    store.lanes = [{ batchIdsJson: JSON.stringify(["rec-1"]) }];
    store.claimedRecs = []; // a rescan already adjudicated them
    await markStaleRunsStopped("acme");
    expect(store.releasedIds).toEqual([]);
    expect(store.releaseEvents).toEqual([]);
  });
});
