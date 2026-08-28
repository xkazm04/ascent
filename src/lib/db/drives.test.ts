// A drive's ROUND TRIP. The whole point of the LoopDrive row is that a status read after a restart
// reports the truth instead of nothing, so the property under test is that what comes back out of the
// row is the same DriveStatus that went in — including the two things a restart is most likely to
// lose: the per-run debt ledger and the chain's inherited run count.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveStatus } from "@/lib/local/drive-types";

/** The "database": one row per id, storing exactly the `data` object the store wrote. */
const rows = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T) => fn().catch(() => fallback),
  getPrisma: () => ({
    loopDrive: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rows.set(String(data.id), { ...data });
        return { ...data };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const prev = rows.get(where.id);
        if (!prev) throw new Error("no such row");
        const next = { ...prev, ...data };
        rows.set(where.id, next);
        return next;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
      // Honors the store's `orderBy: { startedAt: "desc" }` — a mock that ignored it would let a
      // dropped sort pass.
      findMany: vi.fn(async () =>
        [...rows.values()].sort((a, b) => Number(b.startedAt as Date) - Number(a.startedAt as Date)),
      ),
    },
    organization: { findUnique: vi.fn(async () => ({ slug: "acme" })) },
  }),
}));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async () => ({ id: "org-acme" })) }));

import { createDriveRow, getDriveRow, listDriveRows, saveDriveRow, toDriveStatus } from "@/lib/db/drives";

const status = (over: Partial<DriveStatus> = {}): DriveStatus => ({
  id: "drive_1",
  org: "acme",
  phase: "running",
  repos: ["acme/a", "acme/b"],
  maxRuns: 3,
  maxCycles: 3,
  concurrency: 2,
  runs: [],
  measurement: null,
  runsBefore: 0,
  resumedFrom: null,
  startedAt: "2026-08-28T10:00:00.000Z",
  endedAt: null,
  error: null,
  stopRequested: false,
  ...over,
});

beforeEach(() => rows.clear());

describe("LoopDrive persistence — the round trip", () => {
  it("returns the same status it was given", async () => {
    const st = status();
    expect(await createDriveRow(st, "octocat")).toBe(true);
    expect(await getDriveRow("drive_1")).toEqual(st);
  });

  it("carries the per-run debt ledger and the latest measurement through the row", async () => {
    const st = status({
      runs: [
        { runId: "run-1", repos: ["acme/a"], debtBefore: 100, debtAfter: 60, startedAt: "t0", endedAt: "t1" },
        { runId: "run-2", repos: ["acme/a"], debtBefore: 60, debtAfter: null, startedAt: "t2", endedAt: null },
      ],
      measurement: { debt: 60, green: false, greenCount: 1, inScope: 2, remaining: ["acme/a"], unscanned: [] },
    });
    await createDriveRow(st, null);
    await saveDriveRow(st);
    const back = await getDriveRow("drive_1");
    expect(back?.runs).toEqual(st.runs);
    expect(back?.measurement).toEqual(st.measurement);
  });

  it("carries the resume chain — the thing a restart is most likely to lose", async () => {
    const st = status({ id: "drive_2", runsBefore: 2, resumedFrom: "drive_1", phase: "interrupted", endedAt: "2026-08-28T11:00:00.000Z" });
    await createDriveRow(st, null);
    const back = await getDriveRow("drive_2");
    expect(back?.runsBefore).toBe(2);
    expect(back?.resumedFrom).toBe("drive_1");
    expect(back?.phase).toBe("interrupted");
  });

  it("mirrors a whole transition, not a patch — a later read never sees a half-written status", async () => {
    const st = status();
    await createDriveRow(st, null);
    st.phase = "green";
    st.endedAt = "2026-08-28T12:00:00.000Z";
    st.measurement = { debt: 0, green: true, greenCount: 2, inScope: 2, remaining: [], unscanned: [] };
    await saveDriveRow(st);
    expect(await getDriveRow("drive_1")).toEqual(st);
  });

  it("survives a malformed JSON column instead of throwing three layers up a React tree", () => {
    const back = toDriveStatus(
      {
        id: "d",
        orgId: "o",
        createdBy: null,
        phase: "interrupted",
        reposJson: "not json",
        maxRuns: 3,
        maxCycles: 3,
        concurrency: 2,
        runsBefore: 1,
        resumedFrom: null,
        runsJson: "{{{",
        measurementJson: "nope",
        stopRequested: false,
        startedAt: new Date("2026-08-28T10:00:00.000Z"),
        endedAt: null,
        error: null,
      },
      "acme",
    );
    expect(back.repos).toEqual([]);
    expect(back.runs).toEqual([]);
    expect(back.measurement).toBeNull();
    expect(back.phase).toBe("interrupted");
  });

  it("lists an org's drives newest first", async () => {
    await createDriveRow(status({ id: "old", startedAt: "2026-08-27T10:00:00.000Z" }), null);
    await createDriveRow(status({ id: "new", startedAt: "2026-08-28T10:00:00.000Z" }), null);
    expect((await listDriveRows("acme")).map((d) => d.id)).toEqual(["new", "old"]);
  });
});
