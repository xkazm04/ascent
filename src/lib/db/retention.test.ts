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

// ---------------------------------------------------------------------------
// pruneAudit — the audit-retention window + batch-loop TERMINATION. The audit
// half of the job (the compliance-sensitive path) had zero coverage: every prior
// orchestration test used retentionAuditDays:0, so pruneAudit never ran. Here we
// drive a real multi-page sweep (full batch then partial) to prove the loop
// terminates without re-deleting, pin the cutoff window (now − auditDays*DAY_MS)
// and the oldest-first ordering, and prove BOTH the per-org sweep and the org-less
// orphan sweep fire — with the orphan sweep only auditing when it deleted rows.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * Fake prisma whose auditLog.findMany pages through `pages` in order (each call returns the next
 * page; an exhausted/extra call returns []), and whose deleteMany records every batch of ids it was
 * asked to delete. `findManyCalls` captures the `where`/`orderBy`/`take` knobs for the window assertions.
 * No orgs are returned, so only the org-less orphan sweep can run unless the test supplies its own.
 */
function fakeAuditPrisma(opts: {
  pages: string[][];
  org?: { id: string; slug: string; retentionMaxScans: number | null; retentionAuditDays: number | null };
}) {
  const { pages } = opts;
  const deletedBatches: string[][] = [];
  let pageIdx = 0;

  const findMany = vi.fn(async (_args: unknown) => {
    const page = pages[pageIdx] ?? [];
    pageIdx += 1;
    return page.map((id) => ({ id }));
  });
  const deleteMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
    deletedBatches.push([...where.id.in]);
    return { count: where.id.in.length };
  });

  const prisma = {
    organization: { findMany: vi.fn(async () => (opts.org ? [opts.org] : [])) },
    repository: { findMany: vi.fn(async () => []) },
    scan: { findMany: vi.fn(async () => []) },
    auditLog: { findMany, deleteMany },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
  };

  return { prisma, findMany, deleteMany, deletedBatches };
}

describe("pruneAudit — window + batch-loop termination (compliance path)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    for (const k of ENV_KEYS) delete process.env[k];
    vi.mocked(recordAudit).mockClear();
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("pages a full batch then a partial page, deletes exactly those ids, and TERMINATES (no re-delete, no infinite loop)", async () => {
    // Drive a per-org sweep with batchSize=500 (env default): a full 500-id page forces another
    // iteration; the second page is partial (2 ids) which short-circuits the loop. A buggy loop that
    // re-queried after the partial page (or never broke) would call findMany a 3rd time / re-delete.
    const fullPage = Array.from({ length: RETENTION_DEFAULT_BATCH_SIZE }, (_, i) => `a${i}`);
    const partialPage = ["tail_1", "tail_2"];
    const { prisma, findMany, deleteMany, deletedBatches } = fakeAuditPrisma({
      pages: [fullPage, partialPage],
      org: { id: "org_1", slug: "acme", retentionMaxScans: 0, retentionAuditDays: 30 },
    });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary).not.toBeNull();
    // Two pages were fetched, then the loop STOPPED (partial page < batchSize short-circuits) —
    // a 3rd findMany would mean it re-queried after a terminal page (potential infinite loop).
    expect(findMany).toHaveBeenCalledTimes(2);
    // Each page was deleted once, by its exact ids — no batch deleted twice (no re-deleting).
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(deletedBatches).toEqual([fullPage, partialPage]);
    // The org's reported auditDeleted == sum of both pages' counts.
    expect(summary!.auditDeleted).toBe(fullPage.length + partialPage.length);
  });

  it("terminates immediately when the first page is empty (nothing in-window → no deleteMany)", async () => {
    const { prisma, findMany, deleteMany } = fakeAuditPrisma({
      pages: [[]],
      org: { id: "org_1", slug: "acme", retentionMaxScans: 0, retentionAuditDays: 30 },
    });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(findMany).toHaveBeenCalledTimes(1); // one probe, empty → break
    expect(deleteMany).not.toHaveBeenCalled(); // never deletes an empty set
    expect(summary!.auditDeleted).toBe(0);
  });

  it("a single exactly-full page still re-queries once (could be a boundary), then stops on the empty page", async () => {
    // ids.length === batchSize does NOT short-circuit — only ids.length < batchSize (or 0) does.
    // So a full page is followed by one more probe that returns [] and breaks. Pins that the loop
    // does not under-delete by treating a full page as terminal, and does not loop past the empty one.
    const fullPage = Array.from({ length: RETENTION_DEFAULT_BATCH_SIZE }, (_, i) => `b${i}`);
    const { prisma, findMany, deleteMany } = fakeAuditPrisma({
      pages: [fullPage, []],
      org: { id: "org_1", slug: "acme", retentionMaxScans: 0, retentionAuditDays: 30 },
    });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(findMany).toHaveBeenCalledTimes(2); // full page → probe → [] → break
    expect(deleteMany).toHaveBeenCalledTimes(1); // only the one non-empty page is deleted
    expect(summary!.auditDeleted).toBe(fullPage.length);
  });

  it("selects oldest-first within the window: orderBy { at: asc }, take=batchSize, at: { lt: now − auditDays*DAY_MS }", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-19T12:00:00.000Z");
    vi.setSystemTime(now);
    const auditDays = 30;

    const { prisma, findMany } = fakeAuditPrisma({
      pages: [["x"]],
      org: { id: "org_1", slug: "acme", retentionMaxScans: 0, retentionAuditDays: auditDays },
    });
    mockGetPrisma.mockReturnValue(prisma);

    await purgeExpiredData();

    const callArg = findMany.mock.calls[0]![0] as {
      where: { orgId: string; at: { lt: Date } };
      orderBy: { at: string };
      take: number;
      select: { id: true };
    };
    // Oldest-first so the window's tail is drained first (DSQL-friendly forward paging).
    expect(callArg.orderBy).toEqual({ at: "asc" });
    expect(callArg.take).toBe(RETENTION_DEFAULT_BATCH_SIZE);
    expect(callArg.select).toEqual({ id: true });
    expect(callArg.where.orgId).toBe("org_1");
    // Cutoff is exactly now − auditDays*DAY_MS — keeps newer, deletes older. An off-by-one on the
    // day window (or a flipped comparator) would move this boundary and drop in-policy history.
    const expectedCutoff = now.getTime() - auditDays * DAY_MS;
    expect(callArg.where.at.lt).toBeInstanceOf(Date);
    expect(callArg.where.at.lt.getTime()).toBe(expectedCutoff);
  });

  it("runs BOTH the per-org sweep and the org-less orphan sweep when the global default window is set", async () => {
    // Global default auditDays=14 (so the orphan sweep is armed) AND an org with its own auditDays=30.
    process.env.RETENTION_AUDIT_DAYS = "14";
    const orgWhereSeen: Array<{ orgId: string | null }> = [];
    const findMany = vi.fn(async ({ where }: { where: { orgId: string | null; at: { lt: Date } } }) => {
      orgWhereSeen.push({ orgId: where.orgId });
      // Per-org sweep finds 1 row; orphan sweep finds 1 row. Each returns a single partial page → breaks.
      return where.orgId === null ? [{ id: "orphan_1" }] : [{ id: "org_audit_1" }];
    });
    const deleteMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
      count: where.id.in.length,
    }));
    const prisma = {
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_1", slug: "acme", retentionMaxScans: 0, retentionAuditDays: 30 },
        ]),
      },
      repository: { findMany: vi.fn(async () => []) },
      scan: { findMany: vi.fn(async () => []) },
      auditLog: { findMany, deleteMany },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    // The per-org sweep keyed on { orgId: "org_1" } AND the orphan sweep keyed on { orgId: null } both ran.
    expect(orgWhereSeen.some((w) => w.orgId === "org_1")).toBe(true);
    expect(orgWhereSeen.some((w) => w.orgId === null)).toBe(true);
    // An (orphan) result row is recorded since the orphan sweep deleted > 0.
    expect(summary!.results.map((r) => r.orgSlug)).toContain("(orphan)");
  });

  it("the orphan sweep records NO audit entry (and NO result row) when it deletes nothing", async () => {
    // Global default window armed, no orgs, and the orphan sweep finds nothing → it must not push a
    // phantom (orphan) result nor write a retention.purged audit entry for a zero-delete sweep.
    process.env.RETENTION_AUDIT_DAYS = "14";
    const { prisma, deleteMany } = fakeAuditPrisma({ pages: [[]] /* orphan sweep: empty */ });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(deleteMany).not.toHaveBeenCalled();
    expect(summary!.results.map((r) => r.orgSlug)).not.toContain("(orphan)");
    // No retention.purged audit for the orphan scope (the recordAudit is gated on auditDeleted > 0).
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("does NOT run the orphan sweep when the global default audit window is 0/unset", async () => {
    // Per-org audit window is set, but defaults.auditDays === 0 → the { orgId: null } orphan sweep
    // is gated out entirely (line `if (defaults.auditDays > 0)`). Only the per-org sweep should fire.
    const orgWhereSeen: Array<string | null> = [];
    const findMany = vi.fn(async ({ where }: { where: { orgId: string | null } }) => {
      orgWhereSeen.push(where.orgId);
      return []; // empty → one probe each, breaks immediately
    });
    const prisma = {
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_1", slug: "acme", retentionMaxScans: 0, retentionAuditDays: 30 },
        ]),
      },
      repository: { findMany: vi.fn(async () => []) },
      scan: { findMany: vi.fn(async () => []) },
      auditLog: { findMany, deleteMany: vi.fn(async () => ({ count: 0 })) },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    mockGetPrisma.mockReturnValue(prisma);

    await purgeExpiredData();

    // The per-org sweep ran; the org-less orphan sweep was never queried (no { orgId: null } call).
    expect(orgWhereSeen).toContain("org_1");
    expect(orgWhereSeen).not.toContain(null);
  });
});

// ---------------------------------------------------------------------------
// purgeExpiredData — the FLEET-WIDE opt-in safety. The single-org no-op above
// pins the per-org `continue` guard; this block proves the orchestrator-level
// promise over the WHOLE run: when EVERY org is unconfigured (0/unset across the
// fleet, env unset), the entire purge run touches no DB delete path AND writes
// zero audit rows — a misconfiguration (or a fresh deploy that never asked for
// retention) cannot silently wipe the corpus on the first cron tick. The
// counterpart proves the selectivity: one configured org sitting among many
// unconfigured ones purges ONLY itself; the others are left untouched.
// ---------------------------------------------------------------------------

describe("purgeExpiredData — fleet-wide opt-in safety (a misconfig can't silently purge)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    for (const k of ENV_KEYS) delete process.env[k]; // global defaults 0/0 — nothing configured anywhere
    vi.mocked(recordAudit).mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it("with EVERY org unconfigured (0/null across the fleet), the whole run deletes NOTHING and writes ZERO audit rows", async () => {
    // A mix of the ways an org expresses "no retention": null/null (inherit the 0/0 env default),
    // explicit 0/0 (unlimited), and inherit-one / explicit-other-zero combinations. None enforces a
    // window, so the run must be a total no-op — not a single deleteMany, not a single recordAudit.
    const scanFindMany = vi.fn(async () => []);
    const scanDeleteMany = vi.fn(async () => ({ count: 0 }));
    const auditFindMany = vi.fn(async () => []);
    const auditDeleteMany = vi.fn(async () => ({ count: 0 }));
    const txSpy = vi.fn(async (fn: (t: unknown) => unknown) => fn({}));
    const prisma = {
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_a", slug: "a", retentionMaxScans: null, retentionAuditDays: null },
          { id: "org_b", slug: "b", retentionMaxScans: 0, retentionAuditDays: 0 },
          { id: "org_c", slug: "c", retentionMaxScans: null, retentionAuditDays: 0 },
          { id: "org_d", slug: "d", retentionMaxScans: 0, retentionAuditDays: null },
        ]),
      },
      repository: { findMany: vi.fn(async () => [{ id: "repo_x" }]) },
      scan: { findMany: scanFindMany, deleteMany: scanDeleteMany },
      auditLog: { findMany: auditFindMany, deleteMany: auditDeleteMany },
      $transaction: txSpy,
    };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary).not.toBeNull();
    // Not one org crossed the `continue` guard, so NO selection / delete path was ever touched.
    expect(scanFindMany).not.toHaveBeenCalled();
    expect(scanDeleteMany).not.toHaveBeenCalled();
    expect(auditFindMany).not.toHaveBeenCalled(); // includes the org-less orphan sweep (defaults.auditDays === 0)
    expect(auditDeleteMany).not.toHaveBeenCalled();
    expect(txSpy).not.toHaveBeenCalled();
    // ZERO audit rows: the job never logs a no-op enforcement (the opt-in safety).
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
    // The roll-up reports a clean no-op: nobody processed, nothing deleted, no errors.
    expect(summary!.orgsProcessed).toBe(0);
    expect(summary!.results).toEqual([]);
    expect(summary!.scansDeleted).toBe(0);
    expect(summary!.dimensionsDeleted).toBe(0);
    expect(summary!.recommendationsDeleted).toBe(0);
    expect(summary!.recommendationEventsDeleted).toBe(0);
    expect(summary!.auditDeleted).toBe(0);
    expect(summary!.errors).toEqual([]);
  });

  it("one configured org among unconfigured ones purges ONLY itself — the others are left untouched", async () => {
    // Three orgs; only the middle one (org_on) has a real window. The other two (0/null) must be
    // skipped by the `continue` guard, so neither their repos nor their scans are ever queried, and
    // exactly one `retention.purged` audit (for org_on) is written.
    const reposQueriedFor: string[] = [];
    const scanSelectsFor: string[] = [];
    const deletedScanIds: string[] = [];
    const tx = {
      recommendation: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
      recommendationEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      scanDimension: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      scan: {
        deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
          for (const id of where.id.in) deletedScanIds.push(id);
          return { count: where.id.in.length };
        }),
      },
    };
    const prisma = {
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_off1", slug: "off-1", retentionMaxScans: null, retentionAuditDays: null },
          { id: "org_on", slug: "on", retentionMaxScans: 1, retentionAuditDays: 0 },
          { id: "org_off2", slug: "off-2", retentionMaxScans: 0, retentionAuditDays: 0 },
        ]),
      },
      repository: {
        findMany: vi.fn(async ({ where }: { where: { orgId: string } }) => {
          reposQueriedFor.push(where.orgId);
          return where.orgId === "org_on" ? [{ id: "repo_on" }] : [];
        }),
      },
      scan: {
        findMany: vi.fn(async ({ where }: { where: { repoId: string } }) => {
          scanSelectsFor.push(where.repoId);
          // newest-1 kept; two stale scans to drop for the one enforced repo.
          return [{ id: "on_stale_1" }, { id: "on_stale_2" }];
        }),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary).not.toBeNull();
    // The two unconfigured orgs were skipped BEFORE any repo/scan query — only the enabled org's
    // repos and scans were ever touched.
    expect(reposQueriedFor).toEqual(["org_on"]);
    expect(scanSelectsFor).toEqual(["repo_on"]);
    // Exactly the enabled org's stale scans were deleted — nothing from the skipped orgs.
    expect(deletedScanIds.sort()).toEqual(["on_stale_1", "on_stale_2"]);
    // Only the enabled org produced a result row and exactly one self-audit was written.
    expect(summary!.results.map((r) => r.orgSlug)).toEqual(["on"]);
    expect(summary!.orgsProcessed).toBe(1);
    expect(summary!.scansDeleted).toBe(2);
    expect(vi.mocked(recordAudit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAudit)).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ orgId: "org_on" }),
    );
  });
});
