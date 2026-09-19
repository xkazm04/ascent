// markStaleRunsStopped must never stop a run this process is driving. It used to consult no
// liveness at all — every `running` row was "stale" — and the loop route calls it on every GET, so
// a page load during a run stopped the run it was rendering (found 2026-08-26 when the drive
// door's first run died 35 seconds into cycle 1 on the poll that was watching it).
//
// AND THE PREDICATE ONLY ANSWERS FOR RUNS THIS PROCESS COULD DRIVE (UAT `PRIYA-L1-701`). A remote
// run gets no live-registry entry by design, so `isLive` is false for it by CONSTRUCTION rather than
// by death — the executor exclusion is what stops a cockpit read from stopping a healthy remote run.
// The remote consequence was never reproducible on this host, so it is pinned here rather than live.

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = {
  running: [] as { id: string }[],
  stoppedIds: [] as string[],
  laneUpdates: [] as unknown[],
  /** In-flight lanes of the stale runs, with their claimed batch ids. */
  lanes: [] as { batchIdsJson: string }[],
  /** Lanes of the stale runs whose executor is NOT this process — the exclusion's input. */
  externalLanes: [] as { runId: string }[],
  /** Recommendations currently in_progress (the claims a dead run left behind). */
  claimedRecs: [] as { id: string }[],
  releasedIds: [] as string[],
  /** The `data` patch each release wrote — a release must clear the claim, not only the status. */
  releasePatches: [] as Record<string, unknown>[],
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
      // Two different reads share this table: the executor exclusion (keyed on `executor`) and the
      // batch-id read that finds the claims to release. Answering both from one array would let a
      // fixture written for either silently satisfy the other.
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where && "executor" in where ? store.externalLanes : store.lanes,
      ),
      updateMany: vi.fn(async (args: unknown) => {
        store.laneUpdates.push(args);
        return { count: 0 };
      }),
    },
    recommendation: {
      findMany: vi.fn(async () => store.claimedRecs),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: Record<string, unknown> }) => {
        store.releasedIds.push(...where.id.in);
        store.releasePatches.push(data);
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
  store.externalLanes = [];
  store.claimedRecs = [];
  store.releasedIds = [];
  store.releasePatches = [];
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

  // A row released with `claimActor` and `leaseUntil` still on it reads as open-and-still-held: the
  // worklist renders a holder nobody can reach, and the claim path's compare-and-set over
  // (status, leaseUntil) reasons about a lease for a claim that no longer exists.
  it("clears the claim fields with the status — half a release is a zombie of a different shape", async () => {
    store.lanes = [{ batchIdsJson: JSON.stringify(["rec-1"]) }];
    store.claimedRecs = [{ id: "rec-1" }];
    await markStaleRunsStopped("acme", (id) => id === "run-live");
    expect(store.releasePatches).toEqual([{ status: "open", claimActor: null, claimExecutor: null, leaseUntil: null }]);
  });

  it("clears the lease on every lane it errors out", async () => {
    await markStaleRunsStopped("acme", (id) => id === "run-live");
    expect(store.laneUpdates).toHaveLength(1);
    expect((store.laneUpdates[0] as { data: Record<string, unknown> }).data).toMatchObject({
      phase: "error",
      claimedBy: null,
      leaseUntil: null,
    });
  });
});

// UAT PRIYA-L1-701. `startRemoteRun` documents that it creates no live-registry entry, so `isLive`
// is false for a remote run whether it is healthy or dead — and `GET /api/org/loop` fires this sweep
// on every read. Without the executor predicate, opening the cockpit stops the run it is rendering,
// and the lanes it stops take their claims with them.
describe("markStaleRunsStopped — the executor exclusion", () => {
  it("does not stop a run whose lane is driven by a remote agent", async () => {
    store.externalLanes = [{ runId: "run-orphan" }];
    const n = await markStaleRunsStopped("acme", (id) => id === "run-live");
    expect(n).toBe(0);
    expect(store.stoppedIds).toEqual([]);
    expect(store.laneUpdates).toEqual([]);
    expect(store.releasedIds).toEqual([]);
  });

  it("still stops the local runs beside an excluded one — the exclusion is per run, not per sweep", async () => {
    store.running = [{ id: "run-remote" }, { id: "run-local" }];
    store.externalLanes = [{ runId: "run-remote" }];
    const n = await markStaleRunsStopped("acme");
    expect(n).toBe(1);
    expect(store.stoppedIds).toEqual(["run-local"]);
  });

  // Asked as "does this run have ANY lane this process does not drive": the sweep's only verb is
  // stopping the WHOLE run, so one externally-driven lane makes the liveness inference wrong for the
  // row it would stop.
  it("excludes a MIXED run, because the run is what gets stopped", async () => {
    store.running = [{ id: "run-mixed" }];
    store.externalLanes = [{ runId: "run-mixed" }];
    expect(await markStaleRunsStopped("acme")).toBe(0);
    expect(store.stoppedIds).toEqual([]);
  });

  it("excludes a `human` executor too — a person is not a dead process either", async () => {
    store.running = [{ id: "run-human" }];
    store.externalLanes = [{ runId: "run-human" }];
    expect(await markStaleRunsStopped("acme")).toBe(0);
  });
});
