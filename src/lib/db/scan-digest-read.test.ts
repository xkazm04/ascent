// The PERSISTENCE half of retention compaction: the in-transaction upsert, the tail read and its
// `before` boundary, digest ageing, and the coverage helper's honest-null degradation.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma, mockIsDbConfigured } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockIsDbConfigured: vi.fn(),
}));
// Keep the REAL dbReadSafe + withRetry: the degradation contract this file asserts IS dbReadSafe's
// behaviour, so mocking it would test the mock.
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return {
    getPrisma: mockGetPrisma,
    isDbConfigured: mockIsDbConfigured,
    dbReadSafe: actual.dbReadSafe,
    withRetry: actual.withRetry,
    isSerializationConflictError: actual.isSerializationConflictError,
  };
});

import {
  digestScans,
  getCompactionCoverage,
  pruneDigests,
  readDigestTail,
  upsertDigests,
  type DigestInputScan,
} from "@/lib/db/scan-digest";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

function scan(id: string, scannedAt: string, over: Partial<DigestInputScan> = {}): DigestInputScan {
  return {
    id,
    scannedAt: new Date(scannedAt),
    headSha: `sha_${id}`,
    overallScore: 60,
    adoptionScore: 55,
    rigorScore: 65,
    confidence: 0.8,
    level: "L3",
    levelName: "Practicing",
    posture: "balanced",
    rubricVersion: "r9",
    engineProvider: "bedrock",
    engineModel: "sonnet",
    dimensions: [{ dimId: "D1", score: 70, signalScore: 60, llmScore: 80 }],
    recsOpened: 0,
    recsClosed: 0,
    ...over,
  };
}

/** A stored digest row as Prisma hands it back (real Dates, TEXT JSON columns). */
function dbRow(over: Record<string, unknown> = {}) {
  return {
    id: "dg_1",
    repoId: "repo_1",
    period: "2026-03",
    rubricVersion: "r9",
    engineProvider: "bedrock",
    scanCount: 4,
    overallSum: 240,
    adoptionSum: 200,
    rigorSum: 260,
    overallMin: 50,
    overallMax: 70,
    overallLast: 65,
    adoptionLast: 55,
    rigorLast: 66,
    confidenceSum: 3.2,
    levelLast: "L3",
    levelNameLast: "Practicing",
    postureLast: "balanced",
    firstScannedAt: new Date("2026-03-01T00:00:00Z"),
    lastScannedAt: new Date("2026-03-28T00:00:00Z"),
    firstHeadSha: "sha_a",
    lastHeadSha: "sha_d",
    enginesJson: '["sonnet"]',
    dimensionsJson: '{"D1":{"sum":280,"n":4,"last":70,"signalSum":240,"llmSum":320}}',
    recsOpened: 3,
    recsClosed: 1,
    ...over,
  };
}

describe("upsertDigests", () => {
  it("creates a row for a key it has never seen, stamped with the repo", async () => {
    const tx = {
      scanDigest: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
    };
    const drafts = digestScans([scan("a", "2026-03-01T00:00:00Z"), scan("b", "2026-03-05T00:00:00Z")]);
    const written = await upsertDigests(tx as never, "repo_1", drafts);

    expect(written).toBe(1);
    expect(tx.scanDigest.update).not.toHaveBeenCalled();
    const data = tx.scanDigest.create.mock.calls[0]![0]!.data;
    expect(data.repoId).toBe("repo_1");
    expect(data.period).toBe("2026-03");
    expect(data.scanCount).toBe(2);
    expect(data.overallSum).toBe(120);
  });

  it("MERGES into the row a previous tick wrote — the second page adds, it does not overwrite", async () => {
    const existing = dbRow({ scanCount: 2, overallSum: 90, overallMin: 40, overallMax: 50, lastScannedAt: new Date("2026-03-02T00:00:00Z") });
    const tx = {
      scanDigest: {
        findUnique: vi.fn(async () => existing),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
    };
    await upsertDigests(tx as never, "repo_1", digestScans([scan("c", "2026-03-20T00:00:00Z", { overallScore: 90 })]));

    expect(tx.scanDigest.create).not.toHaveBeenCalled();
    const call = tx.scanDigest.update.mock.calls[0]![0]!;
    expect(call.where).toEqual({ id: "dg_1" });
    expect(call.data.scanCount).toBe(3);
    expect(call.data.overallSum).toBe(180);
    expect(call.data.overallMax).toBe(90);
    expect(call.data.lastScannedAt.toISOString()).toBe("2026-03-20T00:00:00.000Z");
  });

  it("keys the lookup on (repoId, period, rubricVersion, engineProvider) — the sentinel, never a null", async () => {
    const tx = {
      scanDigest: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})), update: vi.fn() },
    };
    await upsertDigests(tx as never, "repo_1", digestScans([scan("a", "2026-03-01T00:00:00Z", { rubricVersion: null })]));
    expect(tx.scanDigest.findUnique.mock.calls[0]![0]!.where).toEqual({
      repoId_period_rubricVersion_engineProvider: {
        repoId: "repo_1",
        period: "2026-03",
        rubricVersion: "unknown",
        engineProvider: "bedrock",
      },
    });
  });
});

describe("readDigestTail", () => {
  it("reads newest-first and bounds the read by the oldest RETAINED scan", async () => {
    const findMany = vi.fn(async () => [dbRow()]);
    mockGetPrisma.mockReturnValue({ scanDigest: { findMany } });
    const before = new Date("2026-04-01T00:00:00Z");

    const rows = await readDigestTail("repo_1", { before, limit: 10 });

    const args = findMany.mock.calls[0]![0]!;
    expect(args.where).toEqual({ repoId: "repo_1", lastScannedAt: { lt: before } });
    expect(args.orderBy).toEqual([{ lastScannedAt: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(10);
    // The boundary is what stops a straddling period being counted twice: once as retained scans,
    // once as a summary of the same scans.
    expect(rows[0]!.lastScannedAt).toBe("2026-03-28T00:00:00.000Z");
    expect(rows[0]!.dimensions.D1!.n).toBe(4);
  });

  it("omits the boundary when no `before` is given, and reads nothing at limit 0", async () => {
    const findMany = vi.fn(async () => []);
    mockGetPrisma.mockReturnValue({ scanDigest: { findMany } });

    await readDigestTail("repo_1", { limit: 5 });
    expect(findMany.mock.calls[0]![0]!.where).toEqual({ repoId: "repo_1" });

    expect(await readDigestTail("repo_1", { limit: 0 })).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("returns an empty tail when persistence is off", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await readDigestTail("repo_1", { limit: 10 })).toEqual([]);
  });
});

describe("pruneDigests", () => {
  it("deletes past the cutoff in batches and stops on a short page", async () => {
    const rows = ["d1", "d2", "d3"];
    const prisma = {
      scanDigest: {
        findMany: vi.fn(async ({ take }: { take: number }) => rows.slice(0, take).map((id) => ({ id }))),
        deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
          let count = 0;
          for (const id of where.id.in) {
            const at = rows.indexOf(id);
            if (at >= 0) {
              rows.splice(at, 1);
              count++;
            }
          }
          return { count };
        }),
      },
    };
    const deleted = await pruneDigests(prisma as never, "repo_1", new Date("2024-01-01T00:00:00Z"), 2);
    expect(deleted).toBe(3);
    expect(rows).toEqual([]);
  });

  it("yields at a batch boundary once the run's budget is spent", async () => {
    const prisma = {
      scanDigest: { findMany: vi.fn(async () => [{ id: "d1" }]), deleteMany: vi.fn(async () => ({ count: 1 })) },
    };
    const deleted = await pruneDigests(prisma as never, "repo_1", new Date(), 500, () => true);
    expect(deleted).toBe(0);
    expect(prisma.scanDigest.findMany).not.toHaveBeenCalled();
  });
});

describe("getCompactionCoverage", () => {
  function coveragePrisma(over: Record<string, unknown> = {}) {
    return {
      organization: { findUnique: vi.fn(async () => ({ id: "org_1" })) },
      scanDigest: {
        aggregate: vi.fn(async () => ({
          _count: { _all: 7 },
          _sum: { scanCount: 42 },
          _min: { period: "2024-06", firstScannedAt: new Date("2024-06-02T00:00:00Z") },
        })),
        groupBy: vi.fn(async () => [{ repoId: "r1" }, { repoId: "r2" }]),
      },
      scan: { findFirst: vi.fn(async () => ({ scannedAt: new Date("2025-06-02T00:00:00Z") })) },
      ...over,
    };
  }

  it("reports the span the compacted tail adds back beyond the oldest retained scan", async () => {
    mockGetPrisma.mockReturnValue(coveragePrisma());
    const cov = await getCompactionCoverage("Acme");
    expect(cov).toEqual({
      repos: 2,
      digests: 7,
      scansCompacted: 42,
      oldestPeriod: "2024-06",
      extraSpanDays: 365,
    });
  });

  it("returns null — never zeros — when the read fails", async () => {
    // A DB-unreachable class error is exactly what dbReadSafe swallows; the caller must be told
    // "we could not tell", not shown a confident 0 digests.
    const err = Object.assign(new Error("Can't reach database server"), { name: "PrismaClientInitializationError" });
    mockGetPrisma.mockReturnValue({
      organization: {
        findUnique: vi.fn(async () => {
          throw err;
        }),
      },
    });
    expect(await getCompactionCoverage("acme")).toBeNull();
  });

  it("returns null for an unknown org, and a zero-digest reading with a NULL span", async () => {
    mockGetPrisma.mockReturnValue({ organization: { findUnique: vi.fn(async () => null) } });
    expect(await getCompactionCoverage("nope")).toBeNull();

    mockGetPrisma.mockReturnValue(
      coveragePrisma({
        scanDigest: {
          aggregate: vi.fn(async () => ({ _count: { _all: 0 }, _sum: { scanCount: null }, _min: {} })),
          groupBy: vi.fn(async () => []),
        },
      }),
    );
    // No digests: the span is UNKNOWN, not zero days — there is no "beyond" to measure.
    expect(await getCompactionCoverage("acme")).toEqual({
      repos: 0,
      digests: 0,
      scansCompacted: 0,
      oldestPeriod: null,
      extraSpanDays: null,
    });
  });

  it("returns null when persistence is off", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getCompactionCoverage("acme")).toBeNull();
  });
});
