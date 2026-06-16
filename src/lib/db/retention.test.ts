import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampBatchSize,
  envRetentionDefaults,
  purgeExpiredData,
  resolveRetention,
  RETENTION_DEFAULT_BATCH_SIZE,
  type RetentionPolicy,
} from "@/lib/db/retention";

const { mockGetPrisma, mockIsDbConfigured } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockIsDbConfigured: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: mockIsDbConfigured }));
vi.mock("@/lib/db/scans", () => ({ recordAudit: vi.fn(async () => true) }));
vi.mock("@/lib/public-scan-quota", () => ({ purgeStalePublicScanQuota: vi.fn(async () => 0) }));

const ENV_KEYS = ["RETENTION_MAX_SCANS_PER_REPO", "RETENTION_AUDIT_DAYS", "RETENTION_BATCH_SIZE"] as const;

describe("clampBatchSize", () => {
  it("falls back to the default for null, zero, or negative", () => {
    expect(clampBatchSize(null)).toBe(RETENTION_DEFAULT_BATCH_SIZE);
    expect(clampBatchSize(0)).toBe(RETENTION_DEFAULT_BATCH_SIZE);
    expect(clampBatchSize(-10)).toBe(RETENTION_DEFAULT_BATCH_SIZE);
  });

  it("keeps a valid value and caps oversized ones", () => {
    expect(clampBatchSize(250)).toBe(250);
    expect(clampBatchSize(1_000_000)).toBe(5000);
  });
});

describe("envRetentionDefaults", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to retention disabled (0/0) with the default batch size", () => {
    expect(envRetentionDefaults()).toEqual({
      maxScansPerRepo: 0,
      auditDays: 0,
      batchSize: RETENTION_DEFAULT_BATCH_SIZE,
    });
  });

  it("parses configured values", () => {
    process.env.RETENTION_MAX_SCANS_PER_REPO = "12";
    process.env.RETENTION_AUDIT_DAYS = "90";
    process.env.RETENTION_BATCH_SIZE = "200";
    expect(envRetentionDefaults()).toEqual({ maxScansPerRepo: 12, auditDays: 90, batchSize: 200 });
  });

  it("ignores invalid / negative values and uses the fallbacks", () => {
    process.env.RETENTION_MAX_SCANS_PER_REPO = "not-a-number";
    process.env.RETENTION_AUDIT_DAYS = "-5";
    process.env.RETENTION_BATCH_SIZE = "0";
    expect(envRetentionDefaults()).toEqual({
      maxScansPerRepo: 0,
      auditDays: 0,
      batchSize: RETENTION_DEFAULT_BATCH_SIZE,
    });
  });
});

describe("resolveRetention", () => {
  const defaults: RetentionPolicy = { maxScansPerRepo: 10, auditDays: 30, batchSize: 500 };

  it("inherits the env default when the org override is null", () => {
    expect(resolveRetention(defaults, { retentionMaxScans: null, retentionAuditDays: null })).toEqual({
      maxScansPerRepo: 10,
      auditDays: 30,
      batchSize: 500,
    });
  });

  it("lets a per-org override win over the default", () => {
    expect(resolveRetention(defaults, { retentionMaxScans: 5, retentionAuditDays: 365 })).toEqual({
      maxScansPerRepo: 5,
      auditDays: 365,
      batchSize: 500,
    });
  });

  it("treats an explicit org 0 as unlimited, overriding a non-zero default", () => {
    expect(resolveRetention(defaults, { retentionMaxScans: 0, retentionAuditDays: 0 })).toEqual({
      maxScansPerRepo: 0,
      auditDays: 0,
      batchSize: 500,
    });
  });
});

// A purge over an org that keeps only the newest 1 scan, with 2 stale scans to drop. The fake prisma's
// $transaction runs the callback against a tx whose deleteMany delegates record their call order.
function fakePurgePrisma() {
  const tx = {
    recommendation: {
      findMany: vi.fn(async () => [{ id: "rec_1" }, { id: "rec_2" }]),
      deleteMany: vi.fn(async () => ({ count: 2 })),
    },
    recommendationEvent: { deleteMany: vi.fn(async () => ({ count: 3 })) },
    scanDimension: { deleteMany: vi.fn(async () => ({ count: 8 })) },
    scan: { deleteMany: vi.fn(async () => ({ count: 2 })) },
  };
  let usedTransaction = false;
  const prisma = {
    organization: {
      findMany: vi.fn(async () => [
        { id: "org_1", slug: "acme", retentionMaxScans: 1, retentionAuditDays: 0 },
      ]),
    },
    repository: { findMany: vi.fn(async () => [{ id: "repo_1" }]) },
    scan: { findMany: vi.fn(async () => [{ id: "scan_old_1" }, { id: "scan_old_2" }]) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => {
      usedTransaction = true;
      return fn(tx);
    }),
  };
  return { prisma, tx, used: () => usedTransaction };
}

describe("purgeExpiredData — RecommendationEvent orphans (critical)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    for (const k of ENV_KEYS) delete process.env[k]; // global defaults all 0 → only the per-org policy runs
  });
  afterEach(() => vi.clearAllMocks());

  it("deletes RecommendationEvent grandchildren in one transaction, BEFORE their recommendations", async () => {
    const { prisma, tx, used } = fakePurgePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary).not.toBeNull();
    // The whole scan sub-graph is deleted atomically (a mid-batch timeout can't leave a half-deleted graph).
    expect(used()).toBe(true);
    // RecommendationEvent rows for the stale scans' recommendations are deleted — the orphan the old
    // per-statement loop NEVER deleted (relationMode="prisma" emits no FK cascade).
    expect(tx.recommendationEvent.deleteMany).toHaveBeenCalledWith({
      where: { recommendationId: { in: ["rec_1", "rec_2"] } },
    });
    // …and BEFORE the recommendations themselves (grandchildren → children → parent).
    const evOrder = tx.recommendationEvent.deleteMany.mock.invocationCallOrder[0]!;
    const recOrder = tx.recommendation.deleteMany.mock.invocationCallOrder[0]!;
    const scanOrder = tx.scan.deleteMany.mock.invocationCallOrder[0]!;
    expect(evOrder).toBeLessThan(recOrder);
    expect(recOrder).toBeLessThan(scanOrder);
    expect(summary!.recommendationEventsDeleted).toBe(3);
  });
});
