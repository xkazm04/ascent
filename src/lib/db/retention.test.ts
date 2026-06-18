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

import { recordAudit } from "@/lib/db/scans";

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

// ---------------------------------------------------------------------------
// pruneRepoScans — the scan-SELECTION invariant. The most safety-critical line
// in the module ("rank by DB-authoritative createdAt … could otherwise DELETE a
// live newer scan") was previously asserted only by a mock that ignored its own
// query args. Here a richer fake actually applies orderBy+skip so we prove the
// RIGHT rows (the older ones) are chosen — the newest `max` are KEPT, never in
// the delete set — and that an empty selection never enters a $transaction.
// ---------------------------------------------------------------------------

/**
 * Fake prisma whose scan.findMany honours `orderBy: [{createdAt:"desc"},{id:"desc"}]` + `skip`,
 * so the selection is data-driven (not hard-coded). `rows` are unordered on input; the fake sorts
 * them the way the real query would, then drops the newest `skip`, returning only the survivors that
 * the job should DELETE. Whatever ids reach scan.deleteMany are recorded in `deletedIds`.
 */
function fakeSelectionPrisma(
  rows: Array<{ id: string; createdAt: number }>,
  org: { retentionMaxScans: number | null; retentionAuditDays: number | null } = {
    retentionMaxScans: 2,
    retentionAuditDays: 0,
  },
) {
  const deletedIds: string[] = [];
  let transactions = 0;

  const tx = {
    recommendation: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    recommendationEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    scanDimension: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    scan: {
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        for (const id of where.id.in) deletedIds.push(id);
        return { count: where.id.in.length };
      }),
    },
  };

  const findMany = vi.fn(
    async ({ orderBy, skip, where }: { orderBy?: unknown; skip?: number; where?: unknown }) => {
      // Apply the production ordering: createdAt desc, then id desc (newest first), then skip the
      // newest `skip`. The survivors are the rows the job should delete.
      const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
      const stale = sorted.slice(skip ?? 0);
      // orderBy/where are captured by the spy's recorded call args for the "query knobs" assertion.
      void orderBy;
      void where;
      return stale.map((r) => ({ id: r.id }));
    },
  );

  const prisma = {
    organization: {
      findMany: vi.fn(async () => [{ id: "org_1", slug: "acme", ...org }]),
    },
    repository: { findMany: vi.fn(async () => [{ id: "repo_1" }]) },
    scan: { findMany },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => {
      transactions += 1;
      return fn(tx);
    }),
  };

  return { prisma, findMany, deletedIds, txCount: () => transactions };
}

describe("pruneRepoScans — newest-kept scan selection (data-loss guard)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    for (const k of ENV_KEYS) delete process.env[k]; // global defaults all 0 → only per-org policy runs
  });
  afterEach(() => vi.clearAllMocks());

  it("KEEPS the newest `max` scans and deletes only the older ones (a newer live scan is never deleted)", async () => {
    // 5 scans; createdAt ascending by suffix. With max=2, the newest two (s5, s4) MUST survive;
    // only s3, s2, s1 may be deleted.
    const rows = [
      { id: "s1", createdAt: 100 },
      { id: "s2", createdAt: 200 },
      { id: "s3", createdAt: 300 },
      { id: "s4", createdAt: 400 },
      { id: "s5", createdAt: 500 }, // newest live scan
    ];
    const { prisma, deletedIds } = fakeSelectionPrisma(rows, {
      retentionMaxScans: 2,
      retentionAuditDays: 0,
    });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary).not.toBeNull();
    // The newest two are KEPT…
    expect(deletedIds).not.toContain("s5");
    expect(deletedIds).not.toContain("s4");
    // …and exactly the three oldest are deleted.
    expect(deletedIds.sort()).toEqual(["s1", "s2", "s3"]);
  });

  it("selects via orderBy createdAt desc + skip=max (the dangerous query knobs are pinned)", async () => {
    const rows = [
      { id: "s1", createdAt: 100 },
      { id: "s2", createdAt: 200 },
      { id: "s3", createdAt: 300 },
    ];
    const { prisma, findMany } = fakeSelectionPrisma(rows, {
      retentionMaxScans: 2,
      retentionAuditDays: 0,
    });
    mockGetPrisma.mockReturnValue(prisma);

    await purgeExpiredData();

    // Rank by DB-authoritative createdAt (NOT report-supplied scannedAt), id breaks the tie, and the
    // newest `max` are skipped. If a refactor flips orderBy to scannedAt or drops skip, this fails.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { repoId: "repo_1" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 2,
        select: { id: true },
      }),
    );
  });

  it("does NOT rank by scannedAt — a backdated scannedAt on the newest row cannot get it deleted", async () => {
    // s5 is the newest by createdAt but has the OLDEST scannedAt (clock-skew / backdated report).
    // Selection ranks on createdAt, so s5 stays in the kept set regardless of scannedAt.
    const rows = [
      { id: "s1", createdAt: 100 }, // scannedAt would be newest, irrelevant
      { id: "s2", createdAt: 200 },
      { id: "s5", createdAt: 500 }, // newest live scan, backdated scannedAt
    ];
    const { prisma, deletedIds } = fakeSelectionPrisma(rows, {
      retentionMaxScans: 1,
      retentionAuditDays: 0,
    });
    mockGetPrisma.mockReturnValue(prisma);

    await purgeExpiredData();

    // max=1 keeps only the single newest by createdAt (s5); s1/s2 are deleted, s5 survives.
    expect(deletedIds).not.toContain("s5");
    expect(deletedIds.sort()).toEqual(["s1", "s2"]);
  });

  it("an empty selection (skip >= row count) deletes nothing and never enters a $transaction", async () => {
    const rows = [
      { id: "s1", createdAt: 100 },
      { id: "s2", createdAt: 200 },
    ];
    // max=5 ≥ 2 rows → nothing is stale → no batch, no empty-batch delete.
    const { prisma, deletedIds, txCount } = fakeSelectionPrisma(rows, {
      retentionMaxScans: 5,
      retentionAuditDays: 0,
    });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary!.scansDeleted).toBe(0);
    expect(deletedIds).toEqual([]);
    expect(txCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// purgeExpiredData — per-org fault isolation. One poisoned org (a sustained
// serialization conflict, a transient DSQL outage) must NOT halt retention for
// the whole fleet: the per-org catch records the error and the loop continues.
// ---------------------------------------------------------------------------

describe("purgeExpiredData — per-org error isolation (fleet must keep purging)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => vi.clearAllMocks());

  it("a throw in the FIRST org's prune does not stop the SECOND org from being purged", async () => {
    const okScanDeletes: string[] = [];
    const tx = {
      recommendation: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
      recommendationEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      scanDimension: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      scan: {
        deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
          for (const id of where.id.in) okScanDeletes.push(id);
          return { count: where.id.in.length };
        }),
      },
    };

    const prisma = {
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_bad", slug: "bad-org", retentionMaxScans: 1, retentionAuditDays: 0 },
          { id: "org_good", slug: "good-org", retentionMaxScans: 1, retentionAuditDays: 0 },
        ]),
      },
      repository: {
        findMany: vi.fn(async ({ where }: { where: { orgId: string } }) =>
          where.orgId === "org_bad" ? [{ id: "repo_bad" }] : [{ id: "repo_good" }],
        ),
      },
      scan: {
        // The bad org's repo blows up during selection; the good org's returns one stale scan.
        findMany: vi.fn(async ({ where }: { where: { repoId: string } }) => {
          if (where.repoId === "repo_bad") throw new Error("poisoned org — DSQL outage");
          return [{ id: "good_stale_1" }];
        }),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    // The run COMPLETED (non-null summary) despite one org throwing.
    expect(summary).not.toBeNull();
    // The good org was still processed AFTER the bad one threw — its stale scan was deleted.
    expect(okScanDeletes).toContain("good_stale_1");
    expect(summary!.results.map((r) => r.orgSlug)).toContain("good-org");
    // The failure is surfaced (not swallowed) keyed to the bad org's slug…
    expect(summary!.errors.some((e) => e.startsWith("bad-org:"))).toBe(true);
    // …and the bad org wrote NO success result (recordAudit / push is past the throw).
    expect(summary!.results.map((r) => r.orgSlug)).not.toContain("bad-org");
    expect(summary!.orgsProcessed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// purgeExpiredData — the opt-in safety: nothing configured = delete nothing,
// write no audit. The whole module's promise is that a 0/0 policy is a no-op,
// so an existing deployment that never asked for retention is never wiped on
// the first cron run.
// ---------------------------------------------------------------------------

describe("purgeExpiredData — opt-in no-op when nothing is configured", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    for (const k of ENV_KEYS) delete process.env[k]; // global defaults 0/0
    vi.mocked(recordAudit).mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it("a 0/0 policy (env unset, org overrides null) deletes NOTHING and writes NO audit", async () => {
    const scanFindMany = vi.fn(async () => []);
    const scanDeleteMany = vi.fn(async () => ({ count: 0 }));
    const auditDeleteMany = vi.fn(async () => ({ count: 0 }));
    const prisma = {
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_1", slug: "acme", retentionMaxScans: null, retentionAuditDays: null },
        ]),
      },
      repository: { findMany: vi.fn(async () => [{ id: "repo_1" }]) },
      scan: { findMany: scanFindMany, deleteMany: scanDeleteMany },
      auditLog: { findMany: vi.fn(async () => []), deleteMany: auditDeleteMany },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary).not.toBeNull();
    // The org was SKIPPED before any selection/delete (the `continue` guard).
    expect(scanFindMany).not.toHaveBeenCalled();
    expect(scanDeleteMany).not.toHaveBeenCalled();
    expect(auditDeleteMany).not.toHaveBeenCalled();
    // No no-op audit entry was written, and nothing was counted as processed.
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
    expect(summary!.orgsProcessed).toBe(0);
    expect(summary!.scansDeleted).toBe(0);
    expect(summary!.auditDeleted).toBe(0);
  });

  it("an explicit org override of 0 (unlimited) over a non-zero env default deletes nothing for that org", async () => {
    process.env.RETENTION_MAX_SCANS_PER_REPO = "5"; // global default would prune…
    const scanFindMany = vi.fn(async () => []);
    const prisma = {
      organization: {
        findMany: vi.fn(async () => [
          // …but this org explicitly set 0 = unlimited, which must WIN and disable pruning for it.
          { id: "org_1", slug: "acme", retentionMaxScans: 0, retentionAuditDays: 0 },
        ]),
      },
      repository: { findMany: vi.fn(async () => [{ id: "repo_1" }]) },
      scan: { findMany: scanFindMany, deleteMany: vi.fn(async () => ({ count: 0 })) },
      auditLog: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(scanFindMany).not.toHaveBeenCalled();
    expect(summary!.orgsProcessed).toBe(0);
    expect(summary!.scansDeleted).toBe(0);
  });
});
