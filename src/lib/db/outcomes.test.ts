// The intervention outcome ledger's REFUSALS. The table is only worth citing because of what it
// declines to store, and every one of those refusals is invisible until it has already been violated:
//   1. a pair whose two sides were scored under different instruments writes NO ROW (not a row with
//      a caveat flag) — a median over mixed rubrics measures the ruler, not the repos;
//   2. a legacy scan with no rubricVersion is UNKNOWN, never "the same";
//   3. a dimension absent on either bookend stores `dimDelta: null`, never 0;
//   4. the write is an upsert on the pair identity, because three of the four hooks live on read
//      paths that re-run on every render;
//   5. `isPrivateRepo` is COPIED at write time, and an unknown repo copies the closed default.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  dbReadSafe: async <T>(fn: () => Promise<T>, fallback: T) => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  },
}));
vi.mock("@/lib/db/scans-audit", () => ({ recordAudit: vi.fn(async () => true) }));
vi.mock("@/lib/db/scans-shared", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/scans-shared")>()),
  resolveOrgId: vi.fn(async (slug: string) => (slug === "nope" ? null : "org_1")),
}));

import { listOrgOutcomes, recordOutcomeForScanPair, scenarioIdentityKey } from "./outcomes";

type Bookend = {
  scannedAt: Date;
  overallScore: number;
  rubricVersion: string | null;
  engineProvider: string;
  dimensions: { dimId: string; score: number }[];
};

const scan = (over: Partial<Bookend> = {}): Bookend => ({
  scannedAt: new Date("2026-06-01T00:00:00Z"),
  overallScore: 60,
  rubricVersion: "r10",
  engineProvider: "claude",
  dimensions: [{ dimId: "D2", score: 40 }],
  ...over,
});

const upsert = vi.fn(async () => ({}));
const findMany = vi.fn(async () => []);

function harness(scans: Record<string, Bookend | null>, repo: { isPrivate: boolean } | null = { isPrivate: false }) {
  mockIsDbConfigured.mockReturnValue(true);
  mockGetPrisma.mockReturnValue({
    scan: {
      // The bookends are read in ONE query for the whole candidate set (recordOutcomesForScanPairs),
      // so the harness answers `findMany` with the requested ids that exist — an absent id is simply
      // missing from the result, which is what a real `in` query does.
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => (scans[id] ? { id, ...scans[id] } : null)).filter(Boolean),
    },
    repository: { findUnique: async () => repo },
    interventionOutcome: { upsert, findMany },
  });
}

const pair = {
  orgId: "org_1",
  repoFullName: "acme/web",
  kind: "practice" as const,
  identityKey: "adr-log",
  dimId: "D2" as string | null,
  beforeScanId: "s_before",
  afterScanId: "s_after",
  interventionAt: new Date("2026-06-15T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({});
});

describe("recordOutcomeForScanPair — an unmeasurable pair writes NOTHING", () => {
  it("refuses a rubric MISMATCH outright — no row, not a flagged row", async () => {
    harness({ s_before: scan({ rubricVersion: "r9" }), s_after: scan({ rubricVersion: "r10" }) });
    expect(await recordOutcomeForScanPair(pair)).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses an UNKNOWN instrument — a legacy null rubricVersion is not 'the same'", async () => {
    harness({ s_before: scan({ rubricVersion: null }), s_after: scan() });
    expect(await recordOutcomeForScanPair(pair)).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses an engine-family mismatch (a mock floor is not a model reading)", async () => {
    harness({ s_before: scan({ engineProvider: "mock" }), s_after: scan({ engineProvider: "claude" }) });
    expect(await recordOutcomeForScanPair(pair)).toBe(false);
  });

  it("refuses a missing bookend id, a missing scan row, and a self-pair", async () => {
    harness({ s_before: scan(), s_after: scan() });
    expect(await recordOutcomeForScanPair({ ...pair, beforeScanId: null })).toBe(false);
    expect(await recordOutcomeForScanPair({ ...pair, afterScanId: undefined })).toBe(false);
    expect(await recordOutcomeForScanPair({ ...pair, afterScanId: "s_gone" })).toBe(false);
    expect(await recordOutcomeForScanPair({ ...pair, afterScanId: "s_before" })).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("writes nothing at all when persistence is off", async () => {
    harness({ s_before: scan(), s_after: scan() });
    mockIsDbConfigured.mockReturnValue(false);
    expect(await recordOutcomeForScanPair(pair)).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("recordOutcomeForScanPair — a measurable pair", () => {
  it("stores the deltas, the agreed instrument, the gap and the pairing bound", async () => {
    harness({
      s_before: scan({ scannedAt: new Date("2026-06-01T00:00:00Z"), overallScore: 60, dimensions: [{ dimId: "D2", score: 40 }] }),
      s_after: scan({ scannedAt: new Date("2026-06-11T00:00:00Z"), overallScore: 64, dimensions: [{ dimId: "D2", score: 51 }] }),
    });
    expect(await recordOutcomeForScanPair(pair)).toBe(true);
    const data = upsert.mock.calls[0]![0]!.create;
    expect(data).toMatchObject({
      orgId: "org_1",
      kind: "practice",
      identityKey: "adr-log",
      dimId: "D2",
      overallDelta: 4,
      dimDelta: 11,
      rubricVersion: "r10",
      engineProvider: "claude",
      gapDays: 10,
      withinBound: true,
      isPrivateRepo: false,
    });
  });

  it("stores a MEASURED zero — it is a finding, and the ledger says so", async () => {
    harness({ s_before: scan(), s_after: scan() });
    expect(await recordOutcomeForScanPair({ ...pair, afterScanId: "s_after2" })).toBe(false); // absent id
    harness({ s_before: scan(), s_after: scan({ scannedAt: new Date("2026-06-02T00:00:00Z") }) });
    expect(await recordOutcomeForScanPair(pair)).toBe(true);
    expect(upsert.mock.calls[0]![0]!.create).toMatchObject({ overallDelta: 0, dimDelta: 0 });
  });

  it("a dimension absent on one bookend stores dimDelta null, never 0", async () => {
    harness({ s_before: scan({ dimensions: [] }), s_after: scan({ scannedAt: new Date("2026-06-02T00:00:00Z") }) });
    expect(await recordOutcomeForScanPair(pair)).toBe(true);
    expect(upsert.mock.calls[0]![0]!.create.dimDelta).toBeNull();
  });

  it("a whole-scan outcome (dimId null) carries no dimDelta and no invented dimension", async () => {
    harness({ s_before: scan(), s_after: scan({ scannedAt: new Date("2026-06-02T00:00:00Z"), overallScore: 66 }) });
    expect(await recordOutcomeForScanPair({ ...pair, kind: "scenario", dimId: null })).toBe(true);
    expect(upsert.mock.calls[0]![0]!.create).toMatchObject({ dimId: null, dimDelta: null, overallDelta: 6 });
  });

  it("flags a pair beyond the pairing bound rather than hiding it", async () => {
    harness({ s_before: scan(), s_after: scan({ scannedAt: new Date("2027-06-01T00:00:00Z") }) });
    expect(await recordOutcomeForScanPair(pair)).toBe(true);
    expect(upsert.mock.calls[0]![0]!.create.withinBound).toBe(false);
  });

  it("upserts on the pair identity, so a re-run of a read-path hook writes nothing new", async () => {
    harness({ s_before: scan(), s_after: scan({ scannedAt: new Date("2026-06-02T00:00:00Z") }) });
    await recordOutcomeForScanPair(pair);
    await recordOutcomeForScanPair(pair);
    expect(upsert).toHaveBeenCalledTimes(2);
    for (const call of upsert.mock.calls) {
      expect(call[0]!.where.orgId_kind_identityKey_beforeScanId_afterScanId).toEqual({
        orgId: "org_1",
        kind: "practice",
        identityKey: "adr-log",
        beforeScanId: "s_before",
        afterScanId: "s_after",
      });
    }
  });

  it("copies isPrivateRepo, defaulting an unknown repo CLOSED", async () => {
    harness({ s_before: scan(), s_after: scan({ scannedAt: new Date("2026-06-02T00:00:00Z") }) }, null);
    await recordOutcomeForScanPair(pair);
    expect(upsert.mock.calls[0]![0]!.create.isPrivateRepo).toBe(true);
  });

  it("never lets a ledger write throw into the read path that produced the measurement", async () => {
    harness({ s_before: scan(), s_after: scan({ scannedAt: new Date("2026-06-02T00:00:00Z") }) });
    upsert.mockRejectedValueOnce(new Error("constraint"));
    await expect(recordOutcomeForScanPair(pair)).resolves.toBe(true);
  });
});

describe("listOrgOutcomes", () => {
  it("degrades to [] on an unknown org and never queries across orgId", async () => {
    harness({});
    expect(await listOrgOutcomes("nope")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("scopes every read to the resolved org and maps timestamps to ISO strings", async () => {
    harness({});
    findMany.mockResolvedValueOnce([
      {
        id: "o1",
        orgId: "org_1",
        repoFullName: "acme/web",
        kind: "practice",
        identityKey: "adr-log",
        dimId: "D2",
        beforeScanId: "b",
        afterScanId: "a",
        interventionAt: new Date("2026-06-15T00:00:00Z"),
        overallDelta: 4,
        dimDelta: 11,
        rubricVersion: "r10",
        engineProvider: "claude",
        gapDays: 10,
        withinBound: true,
        isPrivateRepo: false,
        sourceRowId: null,
        recordedAt: new Date("2026-06-16T00:00:00Z"),
        updatedAt: new Date("2026-06-16T00:00:00Z"),
      },
    ] as never);
    const rows = await listOrgOutcomes("acme", { kind: "practice" });
    expect(findMany.mock.calls[0]![0]!.where).toEqual({ orgId: "org_1", kind: "practice" });
    expect(rows[0]!.interventionAt).toBe("2026-06-15T00:00:00.000Z");
    expect(typeof rows[0]!.recordedAt).toBe("string");
  });
});

describe("scenarioIdentityKey", () => {
  it("is order-insensitive — the same selection clicked in another order is the same scenario", () => {
    expect(scenarioIdentityKey('["b","a"]')).toBe(scenarioIdentityKey('["a","b"]'));
  });

  it("distinguishes different selections and degrades garbage to a stable empty identity", () => {
    expect(scenarioIdentityKey('["a"]')).not.toBe(scenarioIdentityKey('["a","b"]'));
    expect(scenarioIdentityKey("not json")).toBe(scenarioIdentityKey("[]"));
  });
});
