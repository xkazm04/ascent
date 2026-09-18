// THE STANDING RUNNER'S ROW (spark theater-upgrade, 2026-09-18). Three properties:
//   • a continuous drive's events ride in `runsJson` beside its runs and come back SPLIT — `runs` stays
//     runs for every reader — while a bounded drive's column is byte-identical to before;
//   • the stale sweep treats `paused` and `idle` as live phases (a runner row left in either by a dead
//     process is as orphaned as `running`);
//   • the boot sweep's read finds exactly the continuous rows in a live phase, with who armed them.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveStatus } from "@/lib/local/drive-types";

const rows = new Map<string, Record<string, unknown>>();
const queries: unknown[] = [];

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T) => fn().catch(() => fallback),
  getPrisma: () => ({
    loopDrive: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (rows.set(String(data.id), { ...data }), data)),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const next = { ...rows.get(where.id), ...data };
        rows.set(where.id, next);
        return next;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null),
      findMany: vi.fn(async (q: unknown) => {
        queries.push(q);
        return [...rows.values()].map((r) => ({ ...r, org: { slug: "acme" } }));
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    organization: { findUnique: vi.fn(async () => ({ slug: "acme" })) },
  }),
}));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async () => ({ id: "org-acme" })) }));

import { createDriveRow, getDriveRow, listRunnerDrivesToResume, markStaleDrivesInterrupted } from "@/lib/db/drives";

const base = (over: Partial<DriveStatus> = {}): DriveStatus => ({
  id: "drive_1",
  org: "acme",
  phase: "running",
  repos: ["acme/a"],
  maxRuns: 3,
  maxCycles: 3,
  concurrency: 2,
  runs: [{ runId: "run-1", repos: ["acme/a"], debtBefore: 10, debtAfter: 8, startedAt: "t0", endedAt: "t1" }],
  measurement: null,
  runsBefore: 0,
  resumedFrom: null,
  model: null,
  effort: null,
  delivery: null,
  startedAt: "2026-09-18T08:00:00.000Z",
  endedAt: null,
  error: null,
  stopRequested: false,
  ...over,
});

beforeEach(() => {
  rows.clear();
  queries.length = 0;
});

describe("the ledger: runs and events in one column, split on read", () => {
  it("round-trips a continuous drive — runner fields, events, and runs that stay runs", async () => {
    const st = base({
      mode: "continuous",
      delivery: "runner",
      maxRuns: 0,
      pausedReason: "spend-ceiling",
      pausedUntil: "2026-09-19T00:00:00.000Z",
      spendCeilingMicros: 1_000_000_000,
      repoState: [{ repo: "acme/a", baseBranch: "main", paused: null, pausedUntil: null, note: null, failureStreak: 0, dryStreak: 1, lastMergeInSha: null, lastLandedSha: null, aheadOfBase: 2 }],
      dials: { batchSize: 8 },
      lastBeatAt: "2026-09-18T09:00:00.000Z",
      events: [{ event: "paused", at: "2026-09-18T09:00:00.000Z", repo: null, reason: "spend-ceiling", until: "2026-09-19T00:00:00.000Z", note: "ceiling" }],
    });
    await createDriveRow(st, "octocat");
    const back = await getDriveRow("drive_1");
    expect(back).toEqual(st);
    expect(back?.runs).toHaveLength(1);
  });

  it("writes a bounded drive's runsJson exactly as before — no events, no new keys on the status", async () => {
    const st = base();
    await createDriveRow(st, null);
    expect(rows.get("drive_1")?.runsJson).toBe(JSON.stringify(st.runs));
    const back = await getDriveRow("drive_1");
    expect(back).not.toHaveProperty("events");
    expect(back).not.toHaveProperty("mode");
  });
});

describe("the sweeps", () => {
  it("markStaleDrivesInterrupted looks at running, paused AND idle rows", async () => {
    await markStaleDrivesInterrupted("acme");
    expect(queries[0]).toMatchObject({ where: { phase: { in: ["running", "paused", "idle"] } } });
  });

  it("listRunnerDrivesToResume reads continuous rows in a live phase, with who armed them", async () => {
    await createDriveRow(base({ mode: "continuous", delivery: "runner" }), "octocat");
    const found = await listRunnerDrivesToResume();
    expect(queries[0]).toMatchObject({ where: { mode: "continuous", phase: { in: ["running", "paused", "idle"] }, endedAt: null } });
    expect(found).toEqual([{ drive: expect.objectContaining({ id: "drive_1", mode: "continuous", org: "acme" }), createdBy: "octocat" }]);
  });
});
