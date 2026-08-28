// markStaleDrivesInterrupted inherits the lesson markStaleRunsStopped learned the hard way on
// 2026-08-26: a reconcile that consults no liveness marks the thing that is currently running. The
// sweep therefore takes an `isLive` predicate, and the ONLY caller entitled to omit it is the boot
// sweep — a fresh process is driving nothing, which is the one situation where "everything running
// is orphaned" is a true statement rather than a destructive one.

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = {
  running: [] as { id: string }[],
  updates: [] as { ids: string[]; data: Record<string, unknown> }[],
};

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T) => fn().catch(() => fallback),
  getPrisma: () => ({
    loopDrive: {
      findMany: vi.fn(async () => store.running),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: Record<string, unknown> }) => {
        store.updates.push({ ids: where.id.in, data });
        return { count: where.id.in.length };
      }),
    },
  }),
}));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async () => ({ id: "org-acme" })) }));

import { DRIVE_INTERRUPTED_REASON, markStaleDrivesInterrupted } from "@/lib/db/drives";

beforeEach(() => {
  store.running = [{ id: "drive-live" }, { id: "drive-orphan" }];
  store.updates = [];
});

describe("markStaleDrivesInterrupted — liveness", () => {
  it("interrupts only the drives the predicate does not vouch for", async () => {
    const n = await markStaleDrivesInterrupted("acme", (id) => id === "drive-live");
    expect(n).toBe(1);
    expect(store.updates).toHaveLength(1);
    expect(store.updates[0]!.ids).toEqual(["drive-orphan"]);
    expect(store.updates[0]!.data.phase).toBe("interrupted");
    expect(store.updates[0]!.data.error).toBe(DRIVE_INTERRUPTED_REASON);
  });

  it("touches nothing when every running drive is live — the poll-during-a-drive case", async () => {
    const n = await markStaleDrivesInterrupted("acme", () => true);
    expect(n).toBe(0);
    expect(store.updates).toEqual([]);
  });

  it("with no predicate treats everything as orphaned — right only for the boot sweep", async () => {
    const n = await markStaleDrivesInterrupted();
    expect(n).toBe(2);
    expect(store.updates[0]!.ids.sort()).toEqual(["drive-live", "drive-orphan"]);
  });

  it("stamps an endedAt, so an interrupted drive is terminal and never reads as still pulling", async () => {
    await markStaleDrivesInterrupted("acme");
    expect(store.updates[0]!.data.endedAt).toBeInstanceOf(Date);
  });

  it("writes nothing at all when there is no running drive", async () => {
    store.running = [];
    expect(await markStaleDrivesInterrupted("acme")).toBe(0);
    expect(store.updates).toEqual([]);
  });
});
