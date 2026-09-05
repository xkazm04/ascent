import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampBatchSize,
  envRetentionDefaults,
  eraseOrgData,
  purgeExpiredData,
  ERASE_ACTION,
  ERASE_AUDIT_FORCE_ENV,
  ERASE_BUDGET_HEADROOM_MS,
  ERASE_DEFAULT_TIME_BUDGET_MS,
  ERASE_MAX_DURATION_S,
  resolveAuditDisposition,
  resolveRetention,
  rotateForTick,
  PURGE_MAX_DURATION_S,
  RETENTION_DEFAULT_BATCH_SIZE,
  RETENTION_MIN_AUDIT_DAYS,
  RETENTION_MIN_SCANS_PER_REPO,
  SCAN_JOB_RETENTION_DAYS,
  SCAN_JOB_SETTLED_STATES,
  type RetentionPolicy,
} from "@/lib/db/retention";

const { mockGetPrisma, mockIsDbConfigured } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockIsDbConfigured: vi.fn(),
}));
// retention.ts now routes its batch deletes through the SHARED withRetry / isSerializationConflictError
// from db/client (finding #4 — the local copies missed DSQL's native OC### codes). Mock only the two
// connection primitives; keep the REAL retry + classifier so the conflict-retry path is genuinely exercised.
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return {
    getPrisma: mockGetPrisma,
    isDbConfigured: mockIsDbConfigured,
    withRetry: actual.withRetry,
    isSerializationConflictError: actual.isSerializationConflictError,
  };
});
vi.mock("@/lib/db/scans", () => ({ recordAudit: vi.fn(async () => true) }));
vi.mock("@/lib/public-scan-quota", () => ({ purgeStalePublicScanQuota: vi.fn(async () => 0) }));

import { recordAudit } from "@/lib/db/scans";
import { AUDIT_REDACTED_META_KEY } from "@/lib/db/audit-integrity";
import { purgeStalePublicScanQuota } from "@/lib/public-scan-quota";

const ENV_KEYS = ["RETENTION_MAX_SCANS_PER_REPO", "RETENTION_AUDIT_DAYS", "RETENTION_BATCH_SIZE"] as const;

// ── MOONSHOT WAVE 1 ledger fakes ───────────────────────────────────────────────────────────────
// The purge and erase paths now reach thirteen additive tables (#9 outcomes, #11 usage events, #14
// the repo-memory mirror, #16 the control ledger + its findings, #18 the registry knowledge /
// conformance / signals tables, #19 usage samples, #36 lessons / traces / memory proposals). A fake
// prisma that omits one makes the sweep THROW rather than silently skip, so every fixture in this
// file is given the full set, empty by default. `seed` is how one test gives a table real rows.
const WAVE1_LEDGERS = [
  "interventionOutcome",
  "usageEvent",
  "repoMemoryMirror",
  "conformanceReport",
  "conformanceFinding",
  "orgSkillLesson",
  "orgSkillTrace",
  "orgMemoryProposal",
  "orgKnowledgeSubject",
  "repoConformance",
  "repoConformanceMap",
  "registrySignal",
  "registrySignalContribution",
  "orgSkillUsageSample",
  // MOONSHOT #32 — a ScanDigest is repo-scoped rather than org-scoped, but it rides in this fixture
  // set for the same reason the others do: `eraseRepo` now drains it, and a fake that omits the
  // delegate makes the sweep THROW rather than silently skip.
  "scanDigest",
  // MOONSHOT WAVE 2 — the same contract, five more tables: #25's lane verdict ledger and memory
  // candidate queue, #33's adoption ledger and mined house patterns, #17's memory citations. They
  // live in the same array because every fixture in this file must carry every delegate the sweeps
  // touch; a missing one is a throw, and a throw inside the per-org try is caught and reported as an
  // ERROR rather than a failure, which is how a whole table quietly stops being erased.
  "laneItemOutcome",
  "orgMemoryCandidate",
  "practiceAdoption",
  "housePatternVersion",
  "orgMemoryCitation",
  // MOONSHOT WAVE 3 — the queue and the control ledger, in the same array for the same reason: the
  // erase path drains all three, and a fixture missing one delegate makes the sweep throw inside the
  // per-org try, where it is caught and reported as an ERROR rather than a failure. `controlObservation`
  // additionally gets `groupBy`/`findFirst` below, which the purge path's keep-newest rule needs.
  "scanJob",
  "controlObservation",
  "controlLedgerSeal",
  // MOONSHOT WAVE 4 — the admission decisions (#8) and the forge installations (#4), in the same
  // array for the same reason as every wave before them: a fixture missing one delegate makes the
  // sweep throw inside the per-org try, where it is caught and reported as an ERROR rather than a
  // failure — which is how a whole table quietly stops being erased.
  "repoAdmission",
  "installation",
] as const;
type Wave1Ledger = (typeof WAVE1_LEDGERS)[number];
type LedgerDelegate = {
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
};

/**
 * Stateful delegates for the wave-1 ledgers: deleted ids really leave `rows`, so the paging loops
 * terminate for the same reason they do in production (a short page) instead of because the mock
 * kept returning the same ids. `rows` is returned so a test can assert what survived.
 */
function makeWave1Ledgers(seed: Partial<Record<Wave1Ledger, string[]>> = {}) {
  const rows = {} as Record<Wave1Ledger, string[]>;
  const delegates = {} as Record<Wave1Ledger, LedgerDelegate>;
  for (const name of WAVE1_LEDGERS) {
    rows[name] = [...(seed[name] ?? [])];
    delegates[name] = {
      findMany: vi.fn(async ({ take }: { take: number }) => rows[name].slice(0, take).map((id) => ({ id }))),
      count: vi.fn(async () => rows[name].length),
      deleteMany: vi.fn(async ({ where }: { where?: { id?: { in: string[] } } } = {}) => {
        // No id list (the per-repo mirror sweep deletes by (orgId, repoFullName)) = take everything.
        const ids = where?.id?.in ?? [...rows[name]];
        let count = 0;
        for (const id of ids) {
          const at = rows[name].indexOf(id);
          if (at >= 0) {
            rows[name].splice(at, 1);
            count++;
          }
        }
        return { count };
      }),
    };
  }
  // MOONSHOT #1 — the purge path reaches ControlObservation through groupBy (one group per
  // (repoFullName, controlId)) and findFirst (the pair's surviving newest row). The generic delegate
  // above has neither, so give the default fixture the "no pairs observed" answer: every pre-existing
  // test in this file is about a fleet with no control ledger, and the wave-3 tests below supply their
  // own row-aware fake. Without these two, the sweep throws inside the per-org try and every one of
  // those tests turns into a silently-caught error instead of a failure.
  (delegates.controlObservation as LedgerDelegate & { groupBy: unknown; findFirst: unknown }).groupBy = vi.fn(
    async () => [] as Array<{ repoFullName: string; controlId: string }>,
  );
  (delegates.controlObservation as LedgerDelegate & { groupBy: unknown; findFirst: unknown }).findFirst = vi.fn(
    async () => null,
  );
  return { rows, delegates };
}

/** The same delegates, empty — the default every pre-existing fixture in this file gets. */
function wave1Delegates() {
  return makeWave1Ledgers().delegates;
}

// Most fixtures in this file deliberately use tiny windows (retentionMaxScans: 1 or 2) to exercise the
// delete machinery with few rows. Those are now below the destructive safety floor (data-retention
// 07-16 #2), so opt the whole file into the documented force escape; the floor-specific tests below
// delete the flag inside the test to prove the refusal path.
beforeEach(() => {
  process.env.RETENTION_FORCE = "1";
});
afterEach(() => {
  delete process.env.RETENTION_FORCE;
});

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
    ...wave1Delegates(),
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
    ...wave1Delegates(),
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

describe("purgeExpiredData — destructive-override safety floor + dry run (data-retention 07-16 #2)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => vi.clearAllMocks());

  it("REFUSES a sub-floor per-org policy without RETENTION_FORCE — nothing deleted, operator paged via errors[]", async () => {
    delete process.env.RETENTION_FORCE;
    const { prisma, used } = fakePurgePrisma(); // org override retentionMaxScans: 1 — below the floor
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    // The org is skipped BEFORE any repo/scan query — a mistyped integer cannot wipe history.
    expect(used()).toBe(false);
    expect(prisma.scan.findMany).not.toHaveBeenCalled();
    expect(summary!.scansDeleted).toBe(0);
    expect(recordAudit).not.toHaveBeenCalled();
    // …and the refusal is VISIBLE: an errors[] entry trips the route's 207 so an operator is paged.
    expect(summary!.errors).toHaveLength(1);
    expect(summary!.errors[0]).toMatch(/safety floor/);
    expect(summary!.dryRun).toBe(false);
  });

  it("a policy AT the floor is applied normally (the floor bounds, it does not creep)", async () => {
    delete process.env.RETENTION_FORCE;
    const { prisma } = fakePurgePrisma();
    prisma.organization.findMany = vi.fn(async () => [
      {
        id: "org_1",
        slug: "acme",
        retentionMaxScans: RETENTION_MIN_SCANS_PER_REPO,
        retentionAuditDays: RETENTION_MIN_AUDIT_DAYS,
      },
    ]);
    (prisma as unknown as { auditLog: unknown }).auditLog = { findMany: vi.fn(async () => []) };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary!.errors).toEqual([]);
    expect(prisma.scan.findMany).toHaveBeenCalled(); // the prune actually ran
  });

  it("dry run counts would-delete rows, deletes nothing, writes no audit, and previews a sub-floor policy", async () => {
    delete process.env.RETENTION_FORCE;
    const prisma = {
      ...wave1Delegates(),
      organization: {
        findMany: vi.fn(async () => [{ id: "org_1", slug: "acme", retentionMaxScans: 1, retentionAuditDays: 3 }]),
      },
      scan: {
        groupBy: vi.fn(async () => [
          { repoId: "r1", _count: { _all: 5 } },
          { repoId: "r2", _count: { _all: 1 } },
        ]),
      },
      auditLog: { count: vi.fn(async () => 4) },
      $transaction: vi.fn(),
    };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData({ dryRun: true });

    expect(summary!.dryRun).toBe(true);
    expect(summary!.scansDeleted).toBe(4); // (5−1) + max(0, 1−1) — per-repo keep-window arithmetic
    expect(summary!.auditDeleted).toBe(4);
    expect(summary!.errors).toEqual([]); // sub-floor previews are exactly what dry run is for
    expect(summary!.orgsProcessed).toBe(1);
    // NOTHING destructive fired: no transaction, no self-audit entry, no quota sweep.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(purgeStalePublicScanQuota).not.toHaveBeenCalled();
  });
});

describe("purgeExpiredData — env budget vs the route cap (data-retention 07-16 #1)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    mockGetPrisma.mockReturnValue({ ...wave1Delegates(), organization: { findMany: vi.fn(async () => []) } });
  });
  afterEach(() => {
    delete process.env.RETENTION_TIME_BUDGET_MS;
    vi.clearAllMocks();
  });

  it("warns when RETENTION_TIME_BUDGET_MS >= the route's declared maxDuration — the budget can never trip first", async () => {
    process.env.RETENTION_TIME_BUDGET_MS = String(PURGE_MAX_DURATION_S * 1000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await purgeExpiredData();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("RETENTION_TIME_BUDGET_MS"));
    warn.mockRestore();
  });

  it("does NOT warn for an env budget safely below the cap (or when the budget is injected via opts)", async () => {
    process.env.RETENTION_TIME_BUDGET_MS = String(PURGE_MAX_DURATION_S * 1000 - 60_000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await purgeExpiredData();
    await purgeExpiredData({ timeBudgetMs: PURGE_MAX_DURATION_S * 1000 * 10 }); // deliberate (tests)
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

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
// withRetry drift (finding #4) — the purge job now uses the SHARED retry, which
// recognizes DSQL's native OC### conflict CODE even with no matching message. The
// old private isSerializationConflict only matched P2034 + a handful of message
// substrings, so a routine DSQL OCC abort surfaced purely as an `OC000` code would
// have aborted a destructive batch delete instead of being retried.
// ---------------------------------------------------------------------------

describe("purgeExpiredData — DSQL OC### conflict is retried (shared withRetry, finding #4)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => vi.clearAllMocks());

  it("retries a scan-prune $transaction that throws a bare OC000-coded conflict, then succeeds", async () => {
    // The conflict the old local classifier missed: a DSQL OCC abort whose only signal is the
    // SQLSTATE-style code OC000 (no '40001'/'serializ'/'write conflict' text). The shared
    // isSerializationConflictError matches /^OC\d{3}$/, so the shared withRetry re-runs the batch.
    const deletedIds: string[] = [];
    let attempts = 0;
    const tx = {
      ...wave1Delegates(),
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
    const prisma = {
      ...wave1Delegates(),
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_1", slug: "acme", retentionMaxScans: 1, retentionAuditDays: 0 },
        ]),
      },
      repository: { findMany: vi.fn(async () => [{ id: "repo_1" }]) },
      scan: { findMany: vi.fn(async () => [{ id: "stale_1" }]) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("conflict"), { code: "OC000" });
        return fn(tx);
      }),
    };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(attempts).toBe(2); // first OC000 → retried → second succeeds
    expect(deletedIds).toEqual(["stale_1"]);
    expect(summary!.scansDeleted).toBe(1);
    expect(summary!.errors).toEqual([]);
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
    ...wave1Delegates(),
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
    ...wave1Delegates(),
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
      ...wave1Delegates(),
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
      ...wave1Delegates(),
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
      ...wave1Delegates(),
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
      ...wave1Delegates(),
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

  const findMany = vi.fn(async () => {
    const page = pages[pageIdx] ?? [];
    pageIdx += 1;
    return page.map((id) => ({ id }));
  });
  const deleteMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
    deletedBatches.push([...where.id.in]);
    return { count: where.id.in.length };
  });

  const prisma = {
    ...wave1Delegates(),
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
      ...wave1Delegates(),
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
      ...wave1Delegates(),
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
      ...wave1Delegates(),
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
      ...wave1Delegates(),
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
      ...wave1Delegates(),
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

  it("pages the repo enumeration with an id cursor instead of one unbounded findMany (finding #5)", async () => {
    // A fleet org's repo list must never be pulled all at once. Simulate >1 page: the mock honors
    // take + cursor so a full first page (matching REPO_PAGE_SIZE=500) forces a second fetch that
    // returns a short page, ending the loop. We assert findMany was called more than once and that the
    // second call carried a cursor positioned past the first page's last id.
    const PAGE = 500;
    const page1 = Array.from({ length: PAGE }, (_, i) => ({ id: `repo_${String(i).padStart(4, "0")}` }));
    const page2 = [{ id: "repo_0500" }]; // short page → terminates
    const repoCalls: Array<{ cursor?: string; take?: number }> = [];
    const prisma = {
      ...wave1Delegates(),
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_on", slug: "on", retentionMaxScans: 1, retentionAuditDays: 0 },
        ]),
      },
      repository: {
        findMany: vi.fn(
          async (args: { take?: number; cursor?: { id: string } }) => {
            repoCalls.push({ cursor: args.cursor?.id, take: args.take });
            return args.cursor ? page2 : page1;
          },
        ),
      },
      scan: { findMany: vi.fn(async () => []) }, // no stale scans → no deletes, just exercising paging
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    mockGetPrisma.mockReturnValue(prisma);

    await purgeExpiredData();

    // More than one page was fetched, the second positioned by a cursor past page1's last id.
    expect(repoCalls.length).toBe(2);
    expect(repoCalls[0]!.cursor).toBeUndefined();
    expect(repoCalls[0]!.take).toBe(PAGE);
    expect(repoCalls[1]!.cursor).toBe("repo_0499"); // last id of the full first page
  });

  it("a configured org with nothing currently expired writes NO audit entry (finding #4)", async () => {
    // org_on has a real policy, but no repos/scans are stale this tick → zero deletes. Previously the
    // job wrote an all-zero `retention.purged` AuditLog row for it every cron tick, forever — audit
    // noise in an audit product. The recordAudit is now gated on totalDeleted > 0.
    const prisma = {
      ...wave1Delegates(),
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_on", slug: "on", retentionMaxScans: 1, retentionAuditDays: 0 },
        ]),
      },
      repository: { findMany: vi.fn(async () => [{ id: "repo_on" }]) },
      scan: { findMany: vi.fn(async () => []) }, // nothing stale → nothing to delete
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary).not.toBeNull();
    expect(summary!.scansDeleted).toBe(0);
    // The org was still visited/processed (the summary reflects the run), but no zero-count audit row.
    expect(summary!.orgsProcessed).toBe(1);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// purgeExpiredData — tail-org starvation guard (finding #2). A large fleet that
// can't drain in one 300s tick used to die at the same prefix every run (stable
// org order), so late-ordered orgs were NEVER reached. The fix rotates the order
// each tick and stops cleanly on a wall-clock budget, surfacing the unreached
// count (which the route turns into a non-2xx, finding #1).
// ---------------------------------------------------------------------------

describe("purgeExpiredData — wall-clock budget + rotation (tail-org starvation, finding #2)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    for (const k of ENV_KEYS) delete process.env[k];
    delete process.env.RETENTION_TIME_BUDGET_MS;
    vi.mocked(recordAudit).mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it("stops cleanly when the time budget is exhausted, leaving the rest for the next tick", async () => {
    const prisma = {
      ...wave1Delegates(),
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_1", slug: "a", retentionMaxScans: 1, retentionAuditDays: 0 },
          { id: "org_2", slug: "b", retentionMaxScans: 1, retentionAuditDays: 0 },
          { id: "org_3", slug: "c", retentionMaxScans: 1, retentionAuditDays: 0 },
        ]),
      },
      repository: { findMany: vi.fn(async () => []) }, // nothing to prune; the org is still "processed"
      scan: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    mockGetPrisma.mockReturnValue(prisma);

    // now() sequence: startedAt=0, iter-0 check=0 (under the 100ms budget → process one org), iter-1
    // check=999 (over budget → stop), then the error-message read=999. No RNG — the per-tick order is a
    // deterministic clock-derived rotation (offset = floor(startedAt/DAY_MS) = 0 here → identity).
    const clock = [0, 0, 999, 999];
    let t = 0;
    const summary = await purgeExpiredData({
      timeBudgetMs: 100,
      now: () => clock[Math.min(t++, clock.length - 1)]!,
    });

    expect(summary).not.toBeNull();
    expect(summary!.stoppedEarly).toBe(true);
    expect(summary!.orgsRemaining).toBe(2); // 3 orgs − 1 processed this tick
    expect(summary!.orgsProcessed).toBe(1);
    // Surfaced as an error so the route returns a non-2xx (finding #1) and cron alerting trips.
    expect(summary!.errors.some((e) => e.startsWith("(budget):"))).toBe(true);
  });

  it("orgsRemaining counts only CONFIGURED orgs in the resume tail, not no-op orgs (data-retention #6)", async () => {
    // Tail = org_2 (no retention window → a no-op skip next tick) + org_3 (configured). Only org_3 is
    // real remaining work, so the resume tail must read 1, not the raw 2 the old `orgs.length - i` gave.
    const prisma = {
      ...wave1Delegates(),
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_1", slug: "a", retentionMaxScans: 1, retentionAuditDays: 0 }, // configured
          { id: "org_2", slug: "b", retentionMaxScans: 0, retentionAuditDays: 0 }, // no-op (unconfigured)
          { id: "org_3", slug: "c", retentionMaxScans: 1, retentionAuditDays: 0 }, // configured
        ]),
      },
      repository: { findMany: vi.fn(async () => []) },
      scan: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    mockGetPrisma.mockReturnValue(prisma);

    const clock = [0, 0, 999, 999]; // startedAt=0, process org_1, then over budget before org_2
    let t = 0;
    const summary = await purgeExpiredData({
      timeBudgetMs: 100,
      now: () => clock[Math.min(t++, clock.length - 1)]!,
    });

    expect(summary!.stoppedEarly).toBe(true);
    expect(summary!.orgsProcessed).toBe(1); // org_1 processed this tick
    expect(summary!.orgsRemaining).toBe(1); // org_2 is a no-op and is NOT counted; only org_3 remains
    expect(summary!.errors.some((e) => e.includes("1 org(s) unprocessed"))).toBe(true);
  });

  it("processes every org and reports stoppedEarly:false when the budget is ample", async () => {
    const prisma = {
      ...wave1Delegates(),
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_1", slug: "a", retentionMaxScans: 1, retentionAuditDays: 0 },
          { id: "org_2", slug: "b", retentionMaxScans: 1, retentionAuditDays: 0 },
        ]),
      },
      repository: { findMany: vi.fn(async () => []) },
      scan: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData({ timeBudgetMs: 1_000_000, now: () => 0 });

    expect(summary!.stoppedEarly).toBe(false);
    expect(summary!.orgsRemaining).toBe(0);
    expect(summary!.orgsProcessed).toBe(2);
    expect(summary!.errors).toEqual([]);
  });

  it("RETENTION_TIME_BUDGET_MS=0 means UNLIMITED — the run completes past the 250s default (data-retention 07-16 #5)", async () => {
    // 0 is the module-wide "disabled" sentinel; the old `||`-coalescing silently swallowed it into the
    // 250s default (this run would then stop at the first over-budget check below and process 0 orgs).
    process.env.RETENTION_TIME_BUDGET_MS = "0";
    const prisma = {
      ...wave1Delegates(),
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_1", slug: "a", retentionMaxScans: 5, retentionAuditDays: 0 },
          { id: "org_2", slug: "b", retentionMaxScans: 5, retentionAuditDays: 0 },
        ]),
      },
      repository: { findMany: vi.fn(async () => []) },
      scan: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    mockGetPrisma.mockReturnValue(prisma);

    // startedAt=0, then every later clock read is far past the 250s default budget — only an
    // unlimited budget lets the run finish all orgs with stoppedEarly:false.
    let first = true;
    const summary = await purgeExpiredData({ now: () => (first ? ((first = false), 0) : 400_000) });
    delete process.env.RETENTION_TIME_BUDGET_MS;

    expect(summary!.stoppedEarly).toBe(false);
    expect(summary!.orgsProcessed).toBe(2);
    expect(summary!.orgsRemaining).toBe(0);
    expect(summary!.errors).toEqual([]);
  });

  it("interrupts a SINGLE large org BETWEEN repos and still records its partial committed deletes (finding #1)", async () => {
    // The exact fleet the budget exists to protect: one org with many repos. The budget must be polled
    // INSIDE the org's repo loop, not only between orgs — otherwise this org runs its whole delete loop
    // past maxDuration and is hard-killed mid-delete with no summary. Here the injected clock crosses the
    // budget AFTER repo_1's scan delete commits, so repo_2 is never reached; the run must YIELD with
    // repo_1's committed deletes reflected, not lost.
    const deletedScanIds: string[] = [];
    const scanSelectsFor: string[] = [];
    let repo1Committed = 0; // flips the injected clock once repo_1's delete commits
    const tx = {
      ...wave1Delegates(),
      recommendation: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
      recommendationEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      scanDimension: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      scan: {
        deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
          for (const id of where.id.in) deletedScanIds.push(id);
          repo1Committed += 1;
          return { count: where.id.in.length };
        }),
      },
    };
    const prisma = {
      ...wave1Delegates(),
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_mega", slug: "mega", retentionMaxScans: 1, retentionAuditDays: 0 },
        ]),
      },
      // One short page of two repos (< REPO_PAGE_SIZE), pruned in order repo_1 then repo_2.
      repository: { findMany: vi.fn(async () => [{ id: "repo_1" }, { id: "repo_2" }]) },
      scan: {
        findMany: vi.fn(async ({ where }: { where: { repoId: string } }) => {
          scanSelectsFor.push(where.repoId);
          return [{ id: "s1" }, { id: "s2" }]; // two stale scans for whichever repo is pruned
        }),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    mockGetPrisma.mockReturnValue(prisma);

    // Budget 100ms. now()=0 until repo_1's delete commits, then 999 (over budget) — so the between-repos
    // check performed BEFORE repo_2 trips and stops the org mid-way.
    const summary = await purgeExpiredData({
      timeBudgetMs: 100,
      now: () => (repo1Committed >= 1 ? 999 : 0),    });

    expect(summary).not.toBeNull();
    // The org yielded BEFORE repo_2 — only repo_1's scans were ever selected/deleted (the interrupt is
    // INSIDE the org, not merely between orgs).
    expect(scanSelectsFor).toEqual(["repo_1"]);
    expect(deletedScanIds.sort()).toEqual(["s1", "s2"]);
    // The partial run is visible + resumable: stoppedEarly, a resume tail, and a `(budget):` error so the
    // route's 207 gate trips — instead of a hard kill with no summary.
    expect(summary!.stoppedEarly).toBe(true);
    expect(summary!.orgsRemaining).toBe(1); // the mega org still holds repo_2 for the next tick
    expect(summary!.errors.some((e) => e.startsWith("(budget):"))).toBe(true);
    // repo_1's committed deletes ARE reflected in the roll-up (not discarded on the early stop).
    expect(summary!.orgsProcessed).toBe(1);
    expect(summary!.scansDeleted).toBe(2);
    expect(summary!.results[0]!.scansDeleted).toBe(2);
  });

  it("skips the trailing sweeps on budget and sets stoppedEarly WITHOUT an error (finding #2 — the silent channel)", async () => {
    // The silent-failure path: the org loop finishes fully WITHIN budget (so it pushes no `(budget):`
    // error), but the clock then crosses the budget, so the org-less orphan-audit sweep AND the
    // public-scan-quota sweep are skipped. They set stoppedEarly but push NO error. This proves the two
    // degraded-signal channels can diverge — errors=[] yet stoppedEarly=true — which is exactly why
    // route.ts now returns 207 on stoppedEarly, not only on errors.length (else this run would be a green 200).
    process.env.RETENTION_AUDIT_DAYS = "14"; // arm the org-less orphan sweep (defaults.auditDays > 0)
    const auditFindMany = vi.fn(async () => []);
    const prisma = {
      ...wave1Delegates(),
      organization: {
        findMany: vi.fn(async () => [
          // A 0/0 org: the loop completes within budget with nothing to push to errors.
          { id: "org_1", slug: "a", retentionMaxScans: 0, retentionAuditDays: 0 },
        ]),
      },
      repository: { findMany: vi.fn(async () => []) },
      scan: { findMany: vi.fn(async () => []) },
      auditLog: { findMany: auditFindMany, deleteMany: vi.fn(async () => ({ count: 0 })) },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    mockGetPrisma.mockReturnValue(prisma);

    // Under budget while the (empty) org loop runs; over budget by the time the trailing sweeps are reached.
    const clock = [0, 0, 999, 999];
    let t = 0;
    const summary = await purgeExpiredData({
      timeBudgetMs: 100,
      now: () => clock[Math.min(t++, clock.length - 1)]!,
    });

    expect(summary).not.toBeNull();
    // Degraded via the stoppedEarly channel ALONE — the org loop pushed no `(budget):` error…
    expect(summary!.stoppedEarly).toBe(true);
    expect(summary!.errors).toEqual([]);
    // …because BOTH trailing sweeps were skipped by the budget (never queried / never invoked).
    expect(auditFindMany).not.toHaveBeenCalled();
    expect(vi.mocked(purgeStalePublicScanQuota)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rotateForTick — deterministic round-robin (data-retention #4). Replaces the
// random shuffle: a stable order rotated by a clock-derived offset gives every
// element a BOUNDED reach to the front (within `length` ticks), where a random
// shuffle only gave probabilistic fairness (a large org could be unlucky forever).
// ---------------------------------------------------------------------------

describe("rotateForTick — bounded round-robin over a stable order (data-retention #4)", () => {
  it("rotates the array in place by offset mod length (deterministic, order-preserving otherwise)", () => {
    const a = ["a", "b", "c", "d"];
    rotateForTick(a, 1);
    expect(a).toEqual(["b", "c", "d", "a"]);
  });

  it("is the identity for offset 0 and for a full-length multiple", () => {
    const a = ["a", "b", "c"];
    rotateForTick(a, 0);
    expect(a).toEqual(["a", "b", "c"]);
    rotateForTick(a, 3); // one full wrap
    expect(a).toEqual(["a", "b", "c"]);
  });

  it("advances the front element by one per unit offset, so EVERY element reaches the front within `length` ticks (bounded reach)", () => {
    const base = ["o0", "o1", "o2", "o3", "o4"];
    // Over `length` consecutive offsets, each element is the front (index 0) exactly once — the
    // starvation guarantee a random shuffle can't make.
    const fronts = new Set<string>();
    for (let offset = 0; offset < base.length; offset++) {
      const a = [...base];
      rotateForTick(a, offset);
      fronts.add(a[0]!);
    }
    expect(fronts).toEqual(new Set(base));
  });

  it("normalizes a negative or large offset into range (no crash, no gap)", () => {
    const a = ["a", "b", "c"];
    rotateForTick(a, -1); // -1 mod 3 → 2
    expect(a).toEqual(["c", "a", "b"]);
    const b = ["a", "b", "c"];
    rotateForTick(b, 7); // 7 mod 3 → 1
    expect(b).toEqual(["b", "c", "a"]);
  });

  it("no-ops a 0- or 1-element array", () => {
    const one = ["only"];
    rotateForTick(one, 5);
    expect(one).toEqual(["only"]);
  });
});

// ---------------------------------------------------------------------------
// purgeExpiredData — a mid-org throw AFTER committed deletes must keep the
// partial counts in the summary (data-retention #3). Committed batches are
// durable; discarding their counts under-reports the run in the compliance view.
// ---------------------------------------------------------------------------

describe("purgeExpiredData — partial committed counts survive a mid-org throw (data-retention #3)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    for (const k of ENV_KEYS) delete process.env[k];
    vi.mocked(recordAudit).mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it("records the org's already-committed scan deletes when a LATER audit sweep throws (not discarded as zero)", async () => {
    // org has BOTH a scan window and an audit window. The scan prune commits (2 scans deleted), THEN the
    // audit sweep throws. The old code declared the counters inside the try and only pushed a result at
    // the end, so the throw discarded the 2 committed deletes; the summary then reported scansDeleted:0.
    const deletedScanIds: string[] = [];
    const tx = {
      ...wave1Delegates(),
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
      ...wave1Delegates(),
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_1", slug: "acme", retentionMaxScans: 1, retentionAuditDays: 30 },
        ]),
      },
      repository: { findMany: vi.fn(async () => [{ id: "repo_1" }]) },
      scan: { findMany: vi.fn(async () => [{ id: "stale_1" }, { id: "stale_2" }]) },
      // The audit sweep (runs AFTER the scan prune) explodes — a mid-org throw with committed scan deletes.
      auditLog: {
        findMany: vi.fn(async () => {
          throw new Error("audit store outage mid-org");
        }),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary).not.toBeNull();
    // The two scans WERE committed before the audit sweep threw…
    expect(deletedScanIds.sort()).toEqual(["stale_1", "stale_2"]);
    // …and those committed deletes are reflected in the summary + its rolled-up totals — not discarded.
    expect(summary!.scansDeleted).toBe(2);
    expect(summary!.results.map((r) => r.orgSlug)).toContain("acme");
    expect(summary!.results.find((r) => r.orgSlug === "acme")!.scansDeleted).toBe(2);
    // The failure is still surfaced so the route's 207 gate trips.
    expect(summary!.errors.some((e) => e.startsWith("acme:"))).toBe(true);
  });

  it("a throw BEFORE any delete writes NO all-zero result row (no compliance noise)", async () => {
    // Selection itself throws → zero committed deletes → the catch must NOT push an all-zero result
    // (mirrors the success-path `totalDeleted > 0` gate). This is the boundary that keeps the per-org
    // error-isolation test's `results` clean.
    const prisma = {
      ...wave1Delegates(),
      organization: {
        findMany: vi.fn(async () => [
          { id: "org_1", slug: "acme", retentionMaxScans: 1, retentionAuditDays: 0 },
        ]),
      },
      repository: { findMany: vi.fn(async () => [{ id: "repo_1" }]) },
      scan: {
        findMany: vi.fn(async () => {
          throw new Error("selection blew up before any delete");
        }),
      },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({})),
    };
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary!.results).toEqual([]); // no all-zero row
    expect(summary!.orgsProcessed).toBe(0);
    expect(summary!.scansDeleted).toBe(0);
    expect(summary!.errors.some((e) => e.startsWith("acme:"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// On-demand erasure (DSR / right-to-erasure). Same delete graph as the cron, triggered by an owner.

/**
 * Stateful fake for eraseOrgData: scans and audit rows are really removed from the fixture, so the
 * paging loops terminate for the same reason they do in production (a short/empty page) rather than
 * because the mock keeps returning the same rows.
 */
function fakeErasePrisma(seed?: {
  repos?: string[];
  audit?: string[];
  loopRuns?: string[];
  athenaThreads?: string[];
  athenaIdentity?: string[];
  athenaMemories?: string[];
}) {
  const repoIds = seed?.repos ?? ["repo_1", "repo_2"];
  const scansByRepo: Record<string, string[]> = {};
  for (const r of repoIds) scansByRepo[r] = [`${r}_s1`, `${r}_s2`];
  const auditRows = [...(seed?.audit ?? ["audit_1", "audit_2", "audit_3"])];
  // Improvement-loop history for the org: two lanes per run, so a test can tell the two counters
  // apart and can see that lanes are removed with (and before) their run.
  const loopRuns = [...(seed?.loopRuns ?? ["loop_1", "loop_2"])];
  const lanesByRun: Record<string, string[]> = {};
  for (const r of loopRuns) lanesByRun[r] = [`${r}_lane_a`, `${r}_lane_b`];
  /** Deletes as they were issued, so a test can assert lanes-before-runs (no FK cascade). */
  const loopDeleteOrder: string[] = [];
  // Athena's org-scoped store: threads with turns and proposals under them, two identity rows
  // (constitution + self-model), and the OrgMemory episodes she wrote (`source: "athena"`). Distinct
  // per-thread counts so a test can tell the three conversation counters apart.
  const athenaThreads = [...(seed?.athenaThreads ?? ["ath_1", "ath_2"])];
  const athenaTurnsByThread: Record<string, string[]> = {};
  const athenaProposalsByThread: Record<string, string[]> = {};
  for (const t of athenaThreads) {
    athenaTurnsByThread[t] = [`${t}_turn_a`, `${t}_turn_b`, `${t}_turn_c`];
    athenaProposalsByThread[t] = [`${t}_prop`];
  }
  const athenaIdentityRows = [...(seed?.athenaIdentity ?? ["ident_constitution", "ident_self_model"])];
  /** OrgMemory rows SHE wrote. Rows from other sources are deliberately absent from the fixture —
   *  the sweep's predicate is `source: "athena"`, and this fake only ever serves that predicate. */
  const athenaMemories = [...(seed?.athenaMemories ?? ["mem_1", "mem_2", "mem_3"])];
  /** Deletes as issued, so a test can assert proposals→turns→threads (no FK cascade). */
  const athenaDeleteOrder: string[] = [];
  const cacheResets: { id: string; data: Record<string, unknown> }[] = [];

  /** Rows as the redaction loop reads them back, and what it wrote (so a test can assert the shape). */
  const auditWrites: { id: string; data: { actorId: unknown; meta: string } }[] = [];

  const tx = {
    ...wave1Delegates(),
    loopRunLane: {
      deleteMany: vi.fn(async ({ where }: { where: { runId: { in: string[] } } }) => {
        loopDeleteOrder.push("lanes");
        let count = 0;
        for (const runId of where.runId.in) {
          count += (lanesByRun[runId] ?? []).length;
          delete lanesByRun[runId];
        }
        return { count };
      }),
    },
    loopRun: {
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        loopDeleteOrder.push("runs");
        let count = 0;
        for (const id of where.id.in) {
          const at = loopRuns.indexOf(id);
          if (at >= 0) {
            loopRuns.splice(at, 1);
            count++;
          }
        }
        return { count };
      }),
    },
    athenaProposal: {
      deleteMany: vi.fn(async ({ where }: { where: { threadId: { in: string[] } } }) => {
        athenaDeleteOrder.push("proposals");
        let count = 0;
        for (const threadId of where.threadId.in) {
          count += (athenaProposalsByThread[threadId] ?? []).length;
          delete athenaProposalsByThread[threadId];
        }
        return { count };
      }),
    },
    athenaTurn: {
      deleteMany: vi.fn(async ({ where }: { where: { threadId: { in: string[] } } }) => {
        athenaDeleteOrder.push("turns");
        let count = 0;
        for (const threadId of where.threadId.in) {
          count += (athenaTurnsByThread[threadId] ?? []).length;
          delete athenaTurnsByThread[threadId];
        }
        return { count };
      }),
    },
    athenaThread: {
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        athenaDeleteOrder.push("threads");
        let count = 0;
        for (const id of where.id.in) {
          const at = athenaThreads.indexOf(id);
          if (at >= 0) {
            athenaThreads.splice(at, 1);
            count++;
          }
        }
        return { count };
      }),
    },
    auditLog: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { actorId: unknown; meta: string } }) => {
        auditWrites.push({ id: where.id, data });
        return { id: where.id };
      }),
    },
    recommendation: {
      findMany: vi.fn(async () => [{ id: "rec_1" }]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    recommendationEvent: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    scanDimension: { deleteMany: vi.fn(async () => ({ count: 4 })) },
    scan: {
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        const gone = new Set(where.id.in);
        let count = 0;
        for (const [repoId, ids] of Object.entries(scansByRepo)) {
          const kept = ids.filter((id) => !gone.has(id));
          count += ids.length - kept.length;
          scansByRepo[repoId] = kept;
        }
        return { count };
      }),
    },
  };

  const prisma = {
    ...wave1Delegates(),
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) =>
        where.slug === "acme" ? { id: "org_1" } : null,
      ),
    },
    repository: {
      findMany: vi.fn(async () => repoIds.map((id) => ({ id }))),
      findUnique: vi.fn(async ({ where }: { where: { orgId_fullName: { fullName: string } } }) =>
        where.orgId_fullName.fullName === "acme/api" ? { id: "repo_1" } : null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        cacheResets.push({ id: where.id, data });
        return { id: where.id };
      }),
    },
    scan: {
      findMany: vi.fn(async ({ where, take }: { where: { repoId: string }; take: number }) =>
        (scansByRepo[where.repoId] ?? []).slice(0, take).map((id) => ({ id })),
      ),
      count: vi.fn(async ({ where }: { where: { repoId: string } }) => (scansByRepo[where.repoId] ?? []).length),
    },
    loopRun: {
      // Cursor-paged like the real read; deleted runs leave the fixture, so the real path's
      // cursor-less paging terminates for the same reason it does in production.
      findMany: vi.fn(async ({ take, cursor, skip }: { take: number; cursor?: { id: string }; skip?: number }) => {
        const from = cursor ? loopRuns.indexOf(cursor.id) + (skip ?? 0) : 0;
        return loopRuns.slice(Math.max(0, from), Math.max(0, from) + take).map((id) => ({ id }));
      }),
    },
    loopRunLane: {
      count: vi.fn(async ({ where }: { where: { runId: { in: string[] } } }) =>
        where.runId.in.reduce((n, runId) => n + (lanesByRun[runId] ?? []).length, 0),
      ),
    },
    athenaThread: {
      // Cursor-paged like the real read; deleted threads leave the fixture, so the real path's
      // cursor-less paging terminates for the same reason it does in production.
      findMany: vi.fn(async ({ take, cursor, skip }: { take: number; cursor?: { id: string }; skip?: number }) => {
        const from = cursor ? athenaThreads.indexOf(cursor.id) + (skip ?? 0) : 0;
        return athenaThreads.slice(Math.max(0, from), Math.max(0, from) + take).map((id) => ({ id }));
      }),
    },
    athenaTurn: {
      count: vi.fn(async ({ where }: { where: { threadId: { in: string[] } } }) =>
        where.threadId.in.reduce((n, threadId) => n + (athenaTurnsByThread[threadId] ?? []).length, 0),
      ),
    },
    athenaProposal: {
      // Org-wide: the preview counts here exactly once, and the real path sweeps here for orphans
      // after the per-thread delete. Both read the same fixture.
      count: vi.fn(async () => Object.values(athenaProposalsByThread).reduce((n, ids) => n + ids.length, 0)),
      deleteMany: vi.fn(async () => {
        athenaDeleteOrder.push("proposals-org");
        let count = 0;
        for (const key of Object.keys(athenaProposalsByThread)) {
          count += athenaProposalsByThread[key]!.length;
          delete athenaProposalsByThread[key];
        }
        return { count };
      }),
    },
    athenaIdentity: {
      count: vi.fn(async () => athenaIdentityRows.length),
      deleteMany: vi.fn(async () => {
        const count = athenaIdentityRows.length;
        athenaIdentityRows.length = 0;
        return { count };
      }),
    },
    orgMemory: {
      // The ONLY predicate this fake serves is the sweep's own `{ orgId, source: "athena" }`; the
      // assertion below pins it, so a widened predicate fails loudly instead of quietly erasing more.
      findMany: vi.fn(async ({ where, take }: { where: { source: string }; take: number }) => {
        expect(where.source).toBe("athena");
        return athenaMemories.slice(0, take).map((id) => ({ id }));
      }),
      count: vi.fn(async ({ where }: { where: { source: string } }) => {
        expect(where.source).toBe("athena");
        return athenaMemories.length;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        let count = 0;
        for (const id of where.id.in) {
          const at = athenaMemories.indexOf(id);
          if (at >= 0) {
            athenaMemories.splice(at, 1);
            count++;
          }
        }
        return { count };
      }),
    },
    auditLog: {
      // Serves BOTH readers: the delete sweep (ids only) and the redaction loop (id/action/orgId/at,
      // cursor-paged). `skip` is honored so the cursor walk advances instead of re-reading page one.
      findMany: vi.fn(async ({ take, cursor, skip }: { take: number; cursor?: { id: string }; skip?: number }) => {
        const from = cursor ? auditRows.indexOf(cursor.id) + (skip ?? 0) : 0;
        return auditRows.slice(Math.max(0, from), Math.max(0, from) + take).map((id) => ({
          id,
          action: `action.${id}`,
          orgId: "org_1",
          at: new Date("2026-01-01T00:00:00.000Z"),
        }));
      }),
      count: vi.fn(async () => auditRows.length),
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        let count = 0;
        for (const id of where.id.in) {
          const at = auditRows.indexOf(id);
          if (at >= 0) {
            auditRows.splice(at, 1);
            count++;
          }
        }
        return { count };
      }),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return {
    prisma,
    tx,
    scansByRepo,
    auditRows,
    cacheResets,
    auditWrites,
    loopRuns,
    lanesByRun,
    loopDeleteOrder,
    athenaThreads,
    athenaTurnsByThread,
    athenaProposalsByThread,
    athenaIdentityRows,
    athenaMemories,
    athenaDeleteOrder,
  };
}

describe("resolveAuditDisposition — the legacy boolean's new meaning (data-retention 07-16 #4)", () => {
  it("defaults to keep, and translates includeAudit:true to the NON-destructive redact", () => {
    expect(resolveAuditDisposition({})).toBe("keep");
    expect(resolveAuditDisposition({ includeAudit: false })).toBe("keep");
    // The boolean used to mean "destroy the whole trail". It now means "make it stop identifying
    // anyone" — the same user-visible promise, without the irreversible loss of the record.
    expect(resolveAuditDisposition({ includeAudit: true })).toBe("redact");
  });

  it("an explicit disposition always wins over the legacy flag", () => {
    expect(resolveAuditDisposition({ includeAudit: true, auditDisposition: "delete" })).toBe("delete");
    expect(resolveAuditDisposition({ includeAudit: true, auditDisposition: "keep" })).toBe("keep");
    expect(resolveAuditDisposition({ auditDisposition: "redact" })).toBe("redact");
  });
});

describe("eraseOrgData — on-demand DSR erasure", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    vi.mocked(recordAudit).mockResolvedValue(true);
    // The destructive-override escape is OFF unless a test opts in — the whole point of the floor.
    delete process.env[ERASE_AUDIT_FORCE_ENV];
  });
  afterEach(() => {
    delete process.env[ERASE_AUDIT_FORCE_ENV];
    vi.clearAllMocks();
  });

  it("refuses cleanly when persistence is off / the org is unknown (no deletes, no audit)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await eraseOrgData({ orgSlug: "acme" })).toEqual({ ok: false, reason: "no-db" });

    mockIsDbConfigured.mockReturnValue(true);
    const { prisma } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    expect(await eraseOrgData({ orgSlug: "ghost" })).toEqual({ ok: false, reason: "unknown-org" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("org scope: ACTUALLY removes every repo's scan graph and resets the scan-derived repo caches", async () => {
    const { prisma, scansByRepo, cacheResets } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The rows are gone from the fixture — not merely "deleteMany was called".
    expect(scansByRepo).toEqual({ repo_1: [], repo_2: [] });
    expect(outcome.scansDeleted).toBe(4); // 2 repos x 2 scans
    expect(outcome.reposProcessed).toBe(2);
    expect(outcome.dimensionsDeleted).toBe(8);
    expect(outcome.recommendationsDeleted).toBe(2);
    expect(outcome.recommendationEventsDeleted).toBe(4);
    expect(outcome.complete).toBe(true);
    expect(outcome.stoppedEarly).toBe(false);
    // Keep-window 0 — the erase keeps NOTHING (what separates it from the retention prune).
    expect(prisma.scan.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
    // Scan-derived caches on Repository are cleared too, so an "erased" repo can't still render its
    // cached passport / tech stack on the dashboard.
    expect(cacheResets.map((c) => c.id).sort()).toEqual(["repo_1", "repo_2"]);
    expect(cacheResets[0]!.data).toMatchObject({ techStackJson: null, passportJson: null, lastScanAt: null });
  });

  // The improvement loop (src/lib/local/loop-engine.ts) writes org-scoped tenant data: which repos
  // were worked, on which branch, which follow-ups were dispatched and closed, and the agent's log.
  // An erasure that left it behind would still read back the org's recent work.
  it("org scope erases the improvement-loop history, lanes BEFORE runs (no FK cascade)", async () => {
    const { prisma, loopRuns, lanesByRun, loopDeleteOrder } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.loopRunsDeleted).toBe(2);
    expect(outcome.loopLanesDeleted).toBe(4); // 2 runs x 2 lanes
    // Gone from the fixture, not merely "deleteMany was called".
    expect(loopRuns).toEqual([]);
    expect(lanesByRun).toEqual({});
    // relationMode = "prisma" emits no cascade, so the children must be deleted first — a run
    // removed before its lanes would strand the lanes forever.
    expect(loopDeleteOrder).toEqual(["lanes", "runs"]);
  });

  it("repo scope never touches loop runs (a run is the org's row, not a repo's)", async () => {
    const { prisma, loopRuns, tx } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme", repoFullName: "acme/api" });

    expect(outcome.ok && outcome.loopRunsDeleted).toBe(0);
    expect(outcome.ok && outcome.loopLanesDeleted).toBe(0);
    expect(tx.loopRun.deleteMany).not.toHaveBeenCalled();
    expect(loopRuns).toHaveLength(2);
  });

  it("a preview COUNTS the loop history it would erase and deletes none of it", async () => {
    const { prisma, loopRuns, tx } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const preview = await eraseOrgData({ orgSlug: "acme", dryRun: true });

    expect(preview.ok && preview.loopRunsDeleted).toBe(2);
    expect(preview.ok && preview.loopLanesDeleted).toBe(4);
    expect(tx.loopRun.deleteMany).not.toHaveBeenCalled();
    expect(tx.loopRunLane.deleteMany).not.toHaveBeenCalled();
    expect(loopRuns).toHaveLength(2);
  });

  // ── Athena (the org-scoped companion) ──────────────────────────────────────────────────────────
  // Her threads are the operator's own words, her self-model is a document about this organization,
  // and her episodes are memories of working with it. An "erasure" that left any of it behind would
  // leave a mind that still remembers the org that asked to be forgotten.

  it("org scope erases Athena's whole store: proposals BEFORE turns BEFORE threads (no FK cascade)", async () => {
    const f = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(f.prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.athenaThreadsDeleted).toBe(2);
    expect(outcome.athenaTurnsDeleted).toBe(6); // 3 per thread
    expect(outcome.athenaProposalsDeleted).toBe(2); // 1 per thread
    expect(outcome.athenaIdentityDeleted).toBe(2); // constitution + self-model
    expect(outcome.athenaMemoriesDeleted).toBe(3);

    // Children before parents — relationMode = "prisma" emits no cascade to do it for us.
    expect(f.athenaDeleteOrder.indexOf("proposals")).toBeLessThan(f.athenaDeleteOrder.indexOf("turns"));
    expect(f.athenaDeleteOrder.indexOf("turns")).toBeLessThan(f.athenaDeleteOrder.indexOf("threads"));

    // Nothing of hers survives the sweep.
    expect(f.athenaThreads).toEqual([]);
    expect(f.athenaIdentityRows).toEqual([]);
    expect(f.athenaMemories).toEqual([]);
    expect(Object.values(f.athenaTurnsByThread)).toEqual([]);
  });

  it("a preview COUNTS Athena's store over the SAME predicates and deletes none of it", async () => {
    const f = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(f.prisma);

    const preview = await eraseOrgData({ orgSlug: "acme", dryRun: true });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const real = (() => {
      const g = fakeErasePrisma();
      mockGetPrisma.mockReturnValue(g.prisma);
      return eraseOrgData({ orgSlug: "acme" });
    })();
    const done = await real;
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    // The number an operator is shown before confirming is the number the confirmed run removes.
    expect(preview.athenaThreadsDeleted).toBe(done.athenaThreadsDeleted);
    expect(preview.athenaTurnsDeleted).toBe(done.athenaTurnsDeleted);
    expect(preview.athenaProposalsDeleted).toBe(done.athenaProposalsDeleted);
    expect(preview.athenaIdentityDeleted).toBe(done.athenaIdentityDeleted);
    expect(preview.athenaMemoriesDeleted).toBe(done.athenaMemoriesDeleted);

    // ...and the preview itself moved nothing.
    expect(f.tx.athenaThread.deleteMany).not.toHaveBeenCalled();
    expect(f.tx.athenaTurn.deleteMany).not.toHaveBeenCalled();
    expect(f.tx.athenaProposal.deleteMany).not.toHaveBeenCalled();
    expect(f.prisma.athenaIdentity.deleteMany).not.toHaveBeenCalled();
    expect(f.prisma.orgMemory.deleteMany).not.toHaveBeenCalled();
    expect(f.athenaThreads).toHaveLength(2);
    expect(f.athenaMemories).toHaveLength(3);
  });

  it("sweeps ONLY the memories Athena wrote — the predicate is source:'athena', never the whole store", async () => {
    const f = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(f.prisma);

    await eraseOrgData({ orgSlug: "acme" });

    // The fixture asserts `where.source === "athena"` on every read; this pins the DELETE side too,
    // so a future widening to "all of the org's memory" cannot slip in under this counter's name.
    for (const call of f.prisma.orgMemory.findMany.mock.calls) {
      expect((call[0] as { where: { source: string } }).where.source).toBe("athena");
    }
    expect(f.prisma.orgMemory.findMany).toHaveBeenCalled();
  });

  it("a repo-scoped erase never touches Athena — a thread is not a repo's row", async () => {
    const f = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(f.prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme", repoFullName: "acme/api" });

    expect(outcome.ok && outcome.athenaThreadsDeleted).toBe(0);
    expect(outcome.ok && outcome.athenaTurnsDeleted).toBe(0);
    expect(outcome.ok && outcome.athenaIdentityDeleted).toBe(0);
    expect(outcome.ok && outcome.athenaMemoriesDeleted).toBe(0);
    expect(f.tx.athenaThread.deleteMany).not.toHaveBeenCalled();
    expect(f.prisma.orgMemory.findMany).not.toHaveBeenCalled();
    expect(f.athenaThreads).toHaveLength(2);
  });

  it("records Athena's counters in the data.erased audit meta (a counter absent there lies)", async () => {
    const { prisma } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await eraseOrgData({ orgSlug: "acme", actorId: "owner-login" });

    const meta = vi.mocked(recordAudit).mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(meta.athenaThreadsDeleted).toBe(2);
    expect(meta.athenaTurnsDeleted).toBe(6);
    expect(meta.athenaProposalsDeleted).toBe(2);
    expect(meta.athenaIdentityDeleted).toBe(2);
    expect(meta.athenaMemoriesDeleted).toBe(3);
  });

  it("org scope leaves the audit trail alone unless includeAudit is set (erasing evidence is a separate ask)", async () => {
    const { prisma, auditRows } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme" });

    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(3);
    expect(outcome.ok && outcome.auditDeleted).toBe(0);
  });

  it("includeAudit now REDACTS the trail to identifier-only instead of destroying it (07-16 #4)", async () => {
    const { prisma, auditRows, auditWrites } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme", includeAudit: true, actorId: "owner-login" });

    // The historical account SURVIVES: every row is still there, none was deleted.
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(3);
    expect(outcome.ok && outcome.auditDeleted).toBe(0);
    expect(outcome.ok && outcome.auditRedacted).toBe(3);
    expect(outcome.ok && outcome.auditDisposition).toBe("redact");
    // …in identifier-only form: the actor is gone and the whole meta payload is replaced by the
    // redaction marker, so the subject reference no longer resolves to a person.
    expect(auditWrites.map((w) => w.id)).toEqual(["audit_1", "audit_2", "audit_3"]);
    for (const w of auditWrites) {
      expect(w.data.actorId).toBeNull();
      expect(Object.keys(JSON.parse(w.data.meta) as object)).toEqual([AUDIT_REDACTED_META_KEY]);
    }
    // Org-scoped, no date cutoff — retention prunes by age, erasure covers everything for the org.
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: "org_1" } }));
    expect(recordAudit).toHaveBeenCalledWith(
      ERASE_ACTION,
      expect.objectContaining({
        scope: "org",
        auditDisposition: "redact",
        includeAudit: true,
        scansDeleted: 4,
        auditRedacted: 3,
        auditDeleted: 0,
        complete: true,
      }),
      { orgId: "org_1", actorId: "owner-login" },
    );
  });

  it('REFUSES auditDisposition:"delete" without the operator override — and erases NOTHING', async () => {
    const { prisma, scansByRepo, auditRows } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme", auditDisposition: "delete" });

    expect(outcome).toEqual({ ok: false, reason: "audit-delete-refused" });
    // The floor is checked BEFORE any delete: a refusal must not leave the scans gone and the trail up.
    expect(scansByRepo).toEqual({ repo_1: ["repo_1_s1", "repo_1_s2"], repo_2: ["repo_2_s1", "repo_2_s2"] });
    expect(auditRows).toHaveLength(3);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('ERASE_AUDIT_FORCE=1 lets a deliberate "delete" through, and data.erased is still written LAST', async () => {
    const { prisma, auditRows } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    process.env[ERASE_AUDIT_FORCE_ENV] = "1";

    const outcome = await eraseOrgData({ orgSlug: "acme", auditDisposition: "delete", actorId: "owner-login" });

    expect(auditRows).toHaveLength(0); // the trail is emptied, as explicitly authorised
    expect(outcome.ok && outcome.auditDeleted).toBe(3);
    expect(outcome.ok && outcome.auditRedacted).toBe(0);
    // ORDERING TRAP: the data.erased entry is written AFTER the sweep, so it survives the erasure it
    // documents. Written first, the sweep (which has no cutoff) would have deleted it.
    const sweepOrder = prisma.auditLog.deleteMany.mock.invocationCallOrder[0]!;
    const auditOrder = vi.mocked(recordAudit).mock.invocationCallOrder[0]!;
    expect(auditOrder).toBeGreaterThan(sweepOrder);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      ERASE_ACTION,
      expect.objectContaining({ auditDisposition: "delete", auditDeleted: 3, complete: true }),
      { orgId: "org_1", actorId: "owner-login" },
    );
  });

  it("PREVIEW counts the casualties without erasing anything, and never writes a trace (07-16 #20)", async () => {
    const { prisma, scansByRepo, auditRows, cacheResets } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const preview = await eraseOrgData({ orgSlug: "acme", includeAudit: true, dryRun: true });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.dryRun).toBe(true);
    expect(preview.scansDeleted).toBe(4); // 2 repos x 2 scans — the number the confirm dialog shows
    expect(preview.reposProcessed).toBe(2);
    expect(preview.auditRedacted).toBe(3);
    // Nothing moved: no deletes, no redaction writes, no cache resets, no data.erased row.
    expect(scansByRepo).toEqual({ repo_1: ["repo_1_s1", "repo_1_s2"], repo_2: ["repo_2_s1", "repo_2_s2"] });
    expect(auditRows).toHaveLength(3);
    expect(cacheResets).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("the preview's scan count comes from the SAME predicate the delete uses (it cannot drift)", async () => {
    const { prisma } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const preview = await eraseOrgData({ orgSlug: "acme", dryRun: true });
    // Same `where` object the delete selection pages over — a preview built from a second, separately
    // written predicate is worse than none: it licenses an irreversible act with the wrong number.
    expect(prisma.scan.count).toHaveBeenCalledWith({ where: { repoId: "repo_1" } });
    const previewed = preview.ok ? preview.scansDeleted : -1;

    const { prisma: prisma2 } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma2);
    const real = await eraseOrgData({ orgSlug: "acme" });
    expect(real.ok && real.scansDeleted).toBe(previewed);
  });

  it("a PREVIEW of the destructive disposition is allowed (seeing the cost is the input to the decision)", async () => {
    const { prisma, auditRows } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const preview = await eraseOrgData({ orgSlug: "acme", auditDisposition: "delete", dryRun: true });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.auditDeleted).toBe(3); // what WOULD be destroyed
    expect(auditRows).toHaveLength(3); // …and still is not
  });

  it('a repo-scoped erase is pinned to "keep" — the trail has no repo dimension, so the floor can\'t fire', async () => {
    const { prisma, auditRows } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme", repoFullName: "acme/api", auditDisposition: "delete" });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.auditDisposition).toBe("keep");
    expect(auditRows).toHaveLength(3);
  });

  it("repo scope erases ONLY that repo (and never touches the audit trail)", async () => {
    const { prisma, scansByRepo, auditRows } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme", repoFullName: "acme/api", includeAudit: true });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(scansByRepo.repo_1).toEqual([]);
    expect(scansByRepo.repo_2).toEqual(["repo_2_s1", "repo_2_s2"]); // untouched
    expect(outcome.scope).toBe("repo");
    expect(outcome.reposProcessed).toBe(1);
    expect(prisma.repository.findMany).not.toHaveBeenCalled(); // no org-wide enumeration
    expect(auditRows).toHaveLength(3); // includeAudit is org-scope only
    expect(recordAudit).toHaveBeenCalledWith(
      ERASE_ACTION,
      expect.objectContaining({ scope: "repo", repo: "acme/api", includeAudit: false }),
      expect.anything(),
    );
  });

  it("returns unknown-repo for a repo outside the org, deleting nothing", async () => {
    const { prisma, scansByRepo } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    expect(await eraseOrgData({ orgSlug: "acme", repoFullName: "someone/else" })).toEqual({
      ok: false,
      reason: "unknown-repo",
    });
    expect(scansByRepo.repo_1).toHaveLength(2);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("is BOUNDED: an exhausted wall-clock budget stops at a boundary and reports a resumable partial", async () => {
    const { prisma, scansByRepo } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    // The clock jumps past the budget almost immediately, so the second repo is never started.
    let t = 0;
    const now = () => (t += 60);

    const outcome = await eraseOrgData({ orgSlug: "acme", timeBudgetMs: 100, now });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.stoppedEarly).toBe(true);
    expect(outcome.complete).toBe(false);
    expect(outcome.reposProcessed).toBeLessThan(2);
    expect(scansByRepo.repo_2).toEqual(["repo_2_s1", "repo_2_s2"]); // resumes on the next call
    // The partial is still audited — a partial erasure is exactly the state that needs a trace.
    expect(recordAudit).toHaveBeenCalledWith(
      ERASE_ACTION,
      expect.objectContaining({ complete: false }),
      expect.anything(),
    );
  });

  it("reports audited:false (not a clean success) when the data.erased write fails — deletes still stand", async () => {
    const { prisma, scansByRepo } = fakeErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    vi.mocked(recordAudit).mockResolvedValue(false);

    const outcome = await eraseOrgData({ orgSlug: "acme" });

    expect(outcome.ok && outcome.audited).toBe(false);
    expect(scansByRepo.repo_1).toEqual([]); // the erasure itself happened
  });

  it("derives its default budget from the route's declared cap (they can never drift apart)", () => {
    expect(ERASE_DEFAULT_TIME_BUDGET_MS).toBe(ERASE_MAX_DURATION_S * 1000 - ERASE_BUDGET_HEADROOM_MS);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MOONSHOT WAVE 1 — the erase/purge cascades for the additive ledgers.
//
// relationMode = "prisma" emits NO foreign keys, so nothing in the database removes a child row for
// us. Two of these tables (#14 RepoMemoryMirror, #16 ConformanceFinding) DO declare
// `onDelete: Cascade`, and that is precisely the trap these tests exist for: the declaration is
// Prisma CLIENT-side emulation, it only runs for deletes the client can resolve through the relation,
// and neither an org erase (which never deletes the Organization row) nor a bulk `deleteMany` on the
// parent triggers it. A schema that LOOKS cascaded and a delete path that doesn't cascade is exactly
// how a table becomes un-erasable, so each assertion below names what fails without its line.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Purge fixture: one org with BOTH a scan window and an audit window, plus seeded wave-1 rows. */
function fakeWave1PurgePrisma() {
  const ledgers = makeWave1Ledgers({
    interventionOutcome: ["io_1", "io_2"],
    usageEvent: ["ue_1", "ue_2", "ue_3"],
    conformanceReport: ["cr_1"],
    conformanceFinding: ["cf_1", "cf_2"],
    // MOONSHOT #17 — citations age like the meter does: this table grows with AGENT TRAFFIC, which
    // no scan window ever bounds.
    orgMemoryCitation: ["ct_1", "ct_2"],
  });
  /** Delete calls in issue order, so a test can assert children-before-parent. */
  const order: string[] = [];
  const stale = ["scan_old_1", "scan_old_2"];

  const spy = (name: Wave1Ledger) => {
    const inner = ledgers.delegates[name].deleteMany;
    return vi.fn(async (args: never) => {
      order.push(name);
      return inner(args);
    });
  };

  const tx = {
    ...ledgers.delegates,
    interventionOutcome: { ...ledgers.delegates.interventionOutcome, deleteMany: spy("interventionOutcome") },
    conformanceFinding: { ...ledgers.delegates.conformanceFinding, deleteMany: spy("conformanceFinding") },
    conformanceReport: { ...ledgers.delegates.conformanceReport, deleteMany: spy("conformanceReport") },
    recommendation: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    recommendationEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    scanDimension: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    scan: {
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        order.push("scan");
        let count = 0;
        for (const id of where.id.in) {
          const at = stale.indexOf(id);
          if (at >= 0) {
            stale.splice(at, 1);
            count++;
          }
        }
        return { count };
      }),
    },
  };

  const prisma = {
    ...ledgers.delegates,
    organization: {
      findMany: vi.fn(async () => [{ id: "org_1", slug: "acme", retentionMaxScans: 5, retentionAuditDays: 30 }]),
    },
    repository: { findMany: vi.fn(async () => [{ id: "repo_1" }]) },
    scan: {
      findMany: vi.fn(async ({ take }: { take: number }) => stale.slice(0, take).map((id) => ({ id }))),
      count: vi.fn(async () => stale.length),
      // The dry-run branch's per-repo count. Present so a preview exercises the SAME org loop the
      // real run does instead of throwing into the catch and reporting an empty (green-looking) run.
      groupBy: vi.fn(async () => [{ repoId: "repo_1", _count: { _all: 7 } }]),
    },
    auditLog: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx, ledgers, order, stale };
}

describe("purgeExpiredData — moonshot wave-1 ledger cascades", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    vi.mocked(recordAudit).mockResolvedValue(true);
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => vi.clearAllMocks());

  // FAIL-BEFORE: without the `tx.interventionOutcome.deleteMany` line inside pruneRepoScans'
  // transaction, `rows.interventionOutcome` still holds io_1/io_2 after their scan bookends are
  // gone — a measured-lift row whose evidence no longer exists and can never be re-derived.
  it("#9: an InterventionOutcome dies inside the SAME transaction as its scan bookends", async () => {
    const { prisma, tx, ledgers, order } = fakeWave1PurgePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(tx.interventionOutcome.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ beforeScanId: { in: ["scan_old_1", "scan_old_2"] } }, { afterScanId: { in: ["scan_old_1", "scan_old_2"] } }] },
    });
    expect(ledgers.rows.interventionOutcome).toEqual([]);
    expect(summary?.outcomesDeleted).toBe(2);
    // Children before the parent: the outcome must not be deleted after the scan it points at.
    expect(order.indexOf("interventionOutcome")).toBeLessThan(order.indexOf("scan"));
  });

  // FAIL-BEFORE: without the UsageEvent sweep, a deployment's metered-inference ledger grows with
  // TRAFFIC and is never bounded by any window — the scan prune cannot reach it (a UsageEvent is not
  // a scan child) and `retentionAuditDays` was the only horizon that ever applied to it.
  it("#11: UsageEvent rows age out on the org's audit horizon", async () => {
    const { prisma, ledgers } = fakeWave1PurgePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(prisma.usageEvent.findMany).toHaveBeenCalled();
    const where = prisma.usageEvent.findMany.mock.calls[0]![0].where;
    expect(where.orgId).toBe("org_1");
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    expect(ledgers.rows.usageEvent).toEqual([]);
    expect(summary?.usageEventsDeleted).toBe(3);
  });

  // FAIL-BEFORE: without the findings delete INSIDE the report transaction, cf_1/cf_2 survive their
  // report forever. The schema's `onDelete: Cascade` reads as if it handles this and does not: a bulk
  // deleteMany never loads the parent rows, so Prisma's emulation never runs.
  it("#16: ConformanceFinding rows are deleted BEFORE their report, in one transaction", async () => {
    const { prisma, ledgers, order } = fakeWave1PurgePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(ledgers.rows.conformanceFinding).toEqual([]);
    expect(ledgers.rows.conformanceReport).toEqual([]);
    expect(summary?.conformanceReportsDeleted).toBe(1);
    expect(summary?.conformanceFindingsDeleted).toBe(2);
    expect(order.indexOf("conformanceFinding")).toBeLessThan(order.indexOf("conformanceReport"));
  });

  it("a dry run previews the two aged ledgers over the same predicate and deletes nothing", async () => {
    const { prisma, ledgers } = fakeWave1PurgePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData({ dryRun: true });

    expect(summary?.usageEventsDeleted).toBe(3);
    expect(summary?.conformanceReportsDeleted).toBe(1);
    expect(ledgers.rows.usageEvent).toEqual(["ue_1", "ue_2", "ue_3"]);
    expect(ledgers.rows.conformanceReport).toEqual(["cr_1"]);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

/** Erase fixture: the org-scoped variant of the same tables, all seeded. */
function fakeWave1ErasePrisma() {
  const ledgers = makeWave1Ledgers({
    interventionOutcome: ["io_1"],
    usageEvent: ["ue_1", "ue_2"],
    repoMemoryMirror: ["mm_1", "mm_2", "mm_3"],
    conformanceReport: ["cr_1"],
    conformanceFinding: ["cf_1"],
    orgSkillLesson: ["ls_1", "ls_2"],
    orgSkillTrace: ["tr_1"],
    orgMemoryProposal: ["mp_1"],
    orgKnowledgeSubject: ["ks_1", "ks_2"],
    repoConformance: ["rc_1"],
    repoConformanceMap: ["rcm_1"],
    registrySignal: ["rs_1"],
    registrySignalContribution: ["rsc_1"],
    orgSkillUsageSample: ["us_1"],
    // MOONSHOT #32 — the repo's compacted tail. A DSR erase must take it too: a stored monthly
    // summary of the erased scans is still that data's shadow.
    scanDigest: ["dg_1", "dg_2"],
    // MOONSHOT WAVE 2 — seeded in the SAME fixture on purpose: the "nothing survives" and "a preview
    // removes nothing" assertions below sweep WAVE1_LEDGERS, so a wave-2 table left unseeded would
    // pass both while never being erased at all.
    laneItemOutcome: ["lo_1", "lo_2"],
    orgMemoryCandidate: ["mc_1"],
    practiceAdoption: ["pa_1", "pa_2"],
    housePatternVersion: ["hp_1"],
    orgMemoryCitation: ["ct_1", "ct_2", "ct_3"],
    // MOONSHOT WAVE 3 — seeded here for the same reason wave 2 was: the "nothing survives an erase"
    // and "a preview removes nothing" assertions sweep WAVE1_LEDGERS, so an unseeded table would pass
    // both while never being erased at all.
    scanJob: ["sj_1", "sj_2"],
    controlObservation: ["co_1", "co_2", "co_3"],
    controlLedgerSeal: ["sl_1"],
    // MOONSHOT WAVE 4 — seeded here for the reason waves 2 and 3 were: the "nothing survives an
    // erase" and "a preview removes nothing" assertions sweep WAVE1_LEDGERS, so an unseeded table
    // would pass both while never being erased at all.
    repoAdmission: ["ad_1", "ad_2"],
    installation: ["in_1"],
  });
  const tx = {
    ...ledgers.delegates,
    recommendation: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    recommendationEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    scanDimension: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    scan: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    loopRunLane: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    loopRun: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    athenaProposal: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    athenaTurn: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    athenaThread: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };
  const prisma = {
    ...ledgers.delegates,
    organization: { findUnique: vi.fn(async () => ({ id: "org_1" })) },
    repository: {
      findMany: vi.fn(async () => [{ id: "repo_1" }]),
      findUnique: vi.fn(async () => ({ id: "repo_1" })),
      update: vi.fn(async () => ({ id: "repo_1" })),
    },
    scan: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    loopRun: { findMany: vi.fn(async () => []) },
    loopRunLane: { count: vi.fn(async () => 0) },
    athenaThread: { findMany: vi.fn(async () => []) },
    athenaTurn: { count: vi.fn(async () => 0) },
    athenaProposal: { count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })) },
    athenaIdentity: { count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })) },
    orgMemory: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    auditLog: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx, ledgers };
}

describe("eraseOrgData — moonshot wave-1 ledger cascades", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    vi.mocked(recordAudit).mockResolvedValue(true);
    delete process.env[ERASE_AUDIT_FORCE_ENV];
  });
  afterEach(() => vi.clearAllMocks());

  // FAIL-BEFORE: without eraseOrgLedgers, an "erasure" leaves behind the org's measured lift, its
  // whole model-spend ledger, its repo-authored memory prose, its per-check control posture, its
  // deviation evidence with file:line citations, and every lesson one of its engineers wrote. The
  // `onDelete: Cascade` on RepoMemoryMirror does NOT cover it: an erase never deletes the
  // Organization row (the tenant keeps existing), so the emulated cascade has nothing to fire on.
  it("org scope: drains every wave-1 ledger and reports what it removed", async () => {
    const { prisma, ledgers } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.outcomesDeleted).toBe(1);
    expect(outcome.usageEventsDeleted).toBe(2);
    expect(outcome.memoryMirrorsDeleted).toBe(3);
    expect(outcome.conformanceReportsDeleted).toBe(1);
    expect(outcome.conformanceFindingsDeleted).toBe(1);
    expect(outcome.skillLessonsDeleted).toBe(2);
    expect(outcome.skillTracesDeleted).toBe(1);
    expect(outcome.memoryProposalsDeleted).toBe(1);
    // ks(2) + rc(1) + rcm(1) + rs(1) + rsc(1) + us(1) — one figure for six tables written by one pass.
    expect(outcome.registryLedgerDeleted).toBe(7);

    // Nothing survives: an erasure that leaves any of these behind is not an erasure.
    for (const name of WAVE1_LEDGERS) expect(ledgers.rows[name]).toEqual([]);
  });

  it("scopes every sweep to the org (never a bare deleteMany over the whole table)", async () => {
    const { prisma } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await eraseOrgData({ orgSlug: "acme" });

    for (const name of ["usageEvent", "orgSkillLesson", "registrySignal", "orgKnowledgeSubject"] as const) {
      const firstFind = prisma[name].findMany.mock.calls[0]![0];
      expect(firstFind.where).toEqual({ orgId: "org_1" });
    }
  });

  // FAIL-BEFORE: without the per-repo mirror delete in eraseRepo, a REPO-scoped erase drops the
  // repo's scans and leaves its mirrored `.ai/memory/` prose readable in the Memory tab — the
  // erasure still reads back what the repo said. The org-wide sweep never runs on this path.
  it("repo scope: removes that repo's mirrored memory, keyed by (orgId, repoFullName)", async () => {
    const { prisma, ledgers } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme", repoFullName: "acme/api" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(prisma.repoMemoryMirror.deleteMany).toHaveBeenCalledWith({
      where: { orgId: "org_1", repoFullName: "acme/api" },
    });
    expect(outcome.memoryMirrorsDeleted).toBe(3);
    expect(ledgers.rows.repoMemoryMirror).toEqual([]);
    // Org-scoped ledgers are NOT touched by a repo-scoped erase — they are not a repo's rows.
    expect(ledgers.rows.orgSkillLesson).toEqual(["ls_1", "ls_2"]);
    expect(ledgers.rows.usageEvent).toEqual(["ue_1", "ue_2"]);
  });

  it("a preview counts every ledger over the delete's own predicate and removes nothing", async () => {
    const { prisma, ledgers } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const preview = await eraseOrgData({ orgSlug: "acme", dryRun: true });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.dryRun).toBe(true);
    expect(preview.usageEventsDeleted).toBe(2);
    expect(preview.memoryMirrorsDeleted).toBe(3);
    expect(preview.registryLedgerDeleted).toBe(7);
    // The preview must not double-count the mirror: the org path deliberately leaves the per-repo
    // delete out, because in a REAL run the second sweep finds nothing while a preview would count
    // the same rows twice — a quiet inflation that only ever shows up in the number a human reads.
    expect(ledgers.rows.repoMemoryMirror).toEqual(["mm_1", "mm_2", "mm_3"]);
    for (const name of WAVE1_LEDGERS) expect(ledgers.rows[name].length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MOONSHOT WAVE 2 — the erase/purge cascades for the five additive tables of this wave.
//
// Same trap as wave 1 and one new one. None of these tables has a foreign key (relationMode =
// "prisma"), so nothing removes them for us; and OrgMemoryCitation adds an ORDERING requirement that
// no schema can express — it points at OrgMemory by a plain string, so it has to be swept before
// anything on the erase path deletes a memory row, or a budget-stopped run leaves citations pointing
// at nothing. Each assertion below names what fails without its line.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("eraseOrgData — moonshot wave-2 ledger cascades", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    vi.mocked(recordAudit).mockResolvedValue(true);
    delete process.env[ERASE_AUDIT_FORCE_ENV];
  });
  afterEach(() => vi.clearAllMocks());

  // FAIL-BEFORE: without the four wave-2 drains in eraseOrgLedgers, an "erasure" leaves behind the
  // agent's verdicts on this org's code (with the file paths it touched), the PENDING memory
  // candidates — which could still be promoted into OrgMemory after the tenant was erased — the
  // per-file adoption hashes of its repositories, and the prose mined out of them.
  it("#25/#33: drains the lane verdicts, the candidate queue and the adoption ledger", async () => {
    const { prisma, ledgers } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.laneOutcomesDeleted).toBe(2);
    expect(outcome.memoryCandidatesDeleted).toBe(1);
    expect(outcome.practiceAdoptionsDeleted).toBe(2);
    expect(outcome.housePatternsDeleted).toBe(1);
    for (const name of ["laneItemOutcome", "orgMemoryCandidate", "practiceAdoption", "housePatternVersion"] as const) {
      expect(ledgers.rows[name]).toEqual([]);
      // Org-scoped, never a bare deleteMany over the whole table (this is a multi-tenant store).
      expect(prisma[name].findMany.mock.calls[0]![0].where).toEqual({ orgId: "org_1" });
    }
  });

  // FAIL-BEFORE: with the citation sweep placed inside eraseOrgLedgers (which runs AFTER the Athena
  // block, and the Athena block deletes the OrgMemory rows she wrote), a budget-stopped run leaves
  // citations addressing memories that no longer exist. The order is the assertion.
  it("#17: citations are swept BEFORE anything deletes an OrgMemory row", async () => {
    const { prisma, ledgers } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.memoryCitationsDeleted).toBe(3);
    expect(ledgers.rows.orgMemoryCitation).toEqual([]);
    expect(prisma.orgMemoryCitation.deleteMany.mock.calls[0]![0].where).toEqual({ id: { in: ["ct_1", "ct_2", "ct_3"] } });
    // The citation delete is issued before the memory sweep even reads its first page.
    const citationAt = prisma.orgMemoryCitation.deleteMany.mock.invocationCallOrder[0]!;
    const memoryReadAt = prisma.orgMemory.findMany.mock.invocationCallOrder[0];
    if (memoryReadAt !== undefined) expect(citationAt).toBeLessThan(memoryReadAt);
  });

  // FAIL-BEFORE: without the per-repo PracticeAdoption delete in eraseRepo, a REPO-scoped erase drops
  // the repo's scans and keeps a durable, path-addressed record of which files that repo held and
  // what was in them — the same failure the mirror sweep exists to prevent, one table over.
  it("#33: a repo-scoped erase takes that repo's adoption rows, keyed by (orgId, repoFullName)", async () => {
    const { prisma, ledgers } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme", repoFullName: "acme/api" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(prisma.practiceAdoption.deleteMany).toHaveBeenCalledWith({
      where: { orgId: "org_1", repoFullName: "acme/api" },
    });
    expect(outcome.practiceAdoptionsDeleted).toBe(2);
    expect(ledgers.rows.practiceAdoption).toEqual([]);
    // A house pattern is mined ACROSS repos, so one repo leaving the org does not un-mine it — and
    // the org-scoped verdict/candidate ledgers are not a repo's rows either.
    expect(ledgers.rows.housePatternVersion).toEqual(["hp_1"]);
    expect(ledgers.rows.laneItemOutcome).toEqual(["lo_1", "lo_2"]);
    expect(ledgers.rows.orgMemoryCandidate).toEqual(["mc_1"]);
  });

  it("a preview counts the wave-2 tables over the delete's own predicate and removes nothing", async () => {
    const { prisma, ledgers } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const preview = await eraseOrgData({ orgSlug: "acme", dryRun: true });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.laneOutcomesDeleted).toBe(2);
    expect(preview.memoryCandidatesDeleted).toBe(1);
    expect(preview.housePatternsDeleted).toBe(1);
    expect(preview.memoryCitationsDeleted).toBe(3);
    // Like the mirror, the adoption ledger is counted ONCE: the org path leaves the per-repo delete
    // out, because a real run's second sweep finds nothing while a preview would count it twice.
    expect(preview.practiceAdoptionsDeleted).toBe(2);
    expect(ledgers.rows.orgMemoryCitation).toEqual(["ct_1", "ct_2", "ct_3"]);
    expect(ledgers.rows.practiceAdoption).toEqual(["pa_1", "pa_2"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MOONSHOT WAVE 4 — two more hand-cascaded tables, and one of them holds a SECRET. #8's
// RepoAdmission keys on (orgId, repoFullName) with no FK, so it needs both halves the mirror and
// the adoption ledger needed: the org sweep and the per-repo delete. #4's Installation is org-level
// and needs only the org sweep — but its `credentialRef` is encryptSecret() ciphertext, so the row
// IS the secret at rest and deleting it is the whole destruction. Each assertion names what fails
// without its line.
//
// Deliberately absent: a rule for #3's four Recommendation claim columns (`claimActor`,
// `claimExecutor`, `leaseUntil`, `needsHuman`). They are columns on a model this module already
// purges and erases row-by-row, so they leave with their row; adding a sweep for them would be a
// second, weaker path to the same delete.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("eraseOrgData — moonshot wave-4 ledger cascades", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    vi.mocked(recordAudit).mockResolvedValue(true);
    delete process.env[ERASE_AUDIT_FORCE_ENV];
  });
  afterEach(() => vi.clearAllMocks());

  // FAIL-BEFORE: without the two wave-4 drains in eraseOrgLedgers, an "erasure" leaves behind a
  // governance verdict naming every one of the tenant's repositories (with who decided it and the
  // rationale they wrote) and — worse — the tenant's forge CREDENTIAL, still encrypted with a key
  // this deployment holds. Neither has an FK to cascade on: an erase never deletes the Organization
  // row, so the emulated cascade has nothing to fire.
  it("#8/#4: drains the admission decisions and the forge installations, org-scoped", async () => {
    const { prisma, ledgers } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.repoAdmissionsDeleted).toBe(2);
    expect(outcome.installationsDeleted).toBe(1);
    for (const name of ["repoAdmission", "installation"] as const) {
      expect(ledgers.rows[name]).toEqual([]);
      // Org-scoped, never a bare deleteMany over the whole table (this is a multi-tenant store, and
      // the credential table is the last one that may ever be swept without a tenant predicate).
      expect(prisma[name].findMany.mock.calls[0]![0].where).toEqual({ orgId: "org_1" });
    }
  });

  // FAIL-BEFORE: without the per-repo RepoAdmission delete in eraseRepo, a REPO-scoped erase drops
  // the repo's scans and keeps a live "agents-allowed" grant for that coordinate — which the
  // admission compiler hands straight back to the next import of the same name, and whose
  // `rulesetId` claims a perimeter nothing here can still check.
  it("#8: a repo-scoped erase takes that repo's admission row, keyed by (orgId, repoFullName)", async () => {
    const { prisma, ledgers } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme", repoFullName: "acme/api" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(prisma.repoAdmission.deleteMany).toHaveBeenCalledWith({
      where: { orgId: "org_1", repoFullName: "acme/api" },
    });
    expect(outcome.repoAdmissionsDeleted).toBe(2);
    expect(ledgers.rows.repoAdmission).toEqual([]);
    // An Installation is the ORG's account with a forge, not a repository's row: one repo leaving
    // must not revoke the credential the rest of the fleet is read through.
    expect(ledgers.rows.installation).toEqual(["in_1"]);
    expect(outcome.installationsDeleted).toBe(0);
  });

  it("a preview counts the wave-4 tables over the delete's own predicate and removes nothing", async () => {
    const { prisma, ledgers } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const preview = await eraseOrgData({ orgSlug: "acme", dryRun: true });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    // Like the mirror and the adoption ledger, the admission rows are counted ONCE: the org path
    // passes no repo name to eraseRepo, so the per-repo count never runs beside the org one.
    expect(preview.repoAdmissionsDeleted).toBe(2);
    expect(preview.installationsDeleted).toBe(1);
    expect(ledgers.rows.repoAdmission).toEqual(["ad_1", "ad_2"]);
    expect(ledgers.rows.installation).toEqual(["in_1"]);
    expect(prisma.repoAdmission.deleteMany).not.toHaveBeenCalled();
    expect(prisma.installation.deleteMany).not.toHaveBeenCalled();
  });
});

describe("purgeExpiredData — moonshot wave-2 citation horizon (#17)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    vi.mocked(recordAudit).mockResolvedValue(true);
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => vi.clearAllMocks());

  // FAIL-BEFORE: without the citation sweep, this table grows with AGENT TRAFFIC and is bounded by
  // nothing — a citation is not a scan child, so the scan prune can never reach it, exactly like the
  // UsageEvent meter beside it.
  it("ages citations out on the org's audit horizon", async () => {
    const { prisma, ledgers } = fakeWave1PurgePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(prisma.orgMemoryCitation.findMany).toHaveBeenCalled();
    const where = prisma.orgMemoryCitation.findMany.mock.calls[0]![0].where;
    expect(where.orgId).toBe("org_1");
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    expect(ledgers.rows.orgMemoryCitation).toEqual([]);
    expect(summary?.memoryCitationsDeleted).toBe(2);
  });

  // FAIL-BEFORE: spec 17 asks for the citations in the COUNTED preview specifically — a dry run that
  // reported 0 while the real run destroyed the org's use-evidence is the number a human reads
  // before approving the purge.
  it("counts them in the dry-run preview and deletes nothing", async () => {
    const { prisma, ledgers } = fakeWave1PurgePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData({ dryRun: true });

    expect(summary?.memoryCitationsDeleted).toBe(2);
    expect(ledgers.rows.orgMemoryCitation).toEqual(["ct_1", "ct_2"]);
    expect(prisma.orgMemoryCitation.deleteMany).not.toHaveBeenCalled();
  });
});

// ── MOONSHOT #32 — retention compaction ────────────────────────────────────────────────────────
// Compaction is OFF by default, so every test ABOVE this line is the regression proof: the purge
// path's page select, transaction and counters are unchanged for a deployment that never asks for it.

/**
 * A purge fixture with real scan rows (the widened fold select) and a stateful `scanDigest` table,
 * so the fold's write is observable and the transaction boundary is real.
 */
function fakeCompactionPrisma(opts: {
  scans: Array<{
    id: string;
    scannedAt: string;
    overallScore: number;
    rubricVersion?: string | null;
    engineProvider?: string;
  }>;
  org?: { retentionCompact: boolean | null; retentionDigestMonths: number | null };
  failDelete?: boolean;
}) {
  const digests: Array<Record<string, unknown>> = [];
  const alive = new Set(opts.scans.map((s) => s.id));

  const scanRow = (s: (typeof opts.scans)[number]) => ({
    id: s.id,
    scannedAt: new Date(s.scannedAt),
    headSha: `sha_${s.id}`,
    overallScore: s.overallScore,
    adoptionScore: 50,
    rigorScore: 60,
    confidence: 0.7,
    level: "L3",
    levelName: "Practicing",
    posture: "balanced",
    rubricVersion: s.rubricVersion === undefined ? "r9" : s.rubricVersion,
    engineProvider: s.engineProvider ?? "bedrock",
    engineModel: "sonnet",
    dimensions: [{ dimId: "D1", score: s.overallScore, signalScore: 10, llmScore: 20 }],
    recommendations: [{ status: "open" }, { status: "done" }],
  });

  const scanDigest = {
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: Record<string, { period: string; rubricVersion: string; engineProvider: string }>;
      }) => {
        const k = where.repoId_period_rubricVersion_engineProvider!;
        return (
          digests.find(
            (d) =>
              d.period === k.period && d.rubricVersion === k.rubricVersion && d.engineProvider === k.engineProvider,
          ) ?? null
        );
      },
    ),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      digests.push({ id: `dg_${digests.length + 1}`, ...data });
      return data;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const at = digests.findIndex((d) => d.id === where.id);
      digests[at] = { ...digests[at], ...data };
      return data;
    }),
    findMany: vi.fn(async () => [] as { id: string }[]),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    count: vi.fn(async () => digests.length),
  };

  const tx = {
    ...wave1Delegates(),
    scanDigest,
    recommendation: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    recommendationEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    scanDimension: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    scan: {
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        if (opts.failDelete) throw new Error("delete exploded");
        for (const id of where.id.in) alive.delete(id);
        return { count: where.id.in.length };
      }),
    },
  };

  const prisma = {
    ...wave1Delegates(),
    scanDigest,
    organization: {
      findMany: vi.fn(async () => [
        {
          id: "org_1",
          slug: "acme",
          retentionMaxScans: 1,
          retentionAuditDays: 0,
          // `??` would swallow an explicit `null` (the "inherit the env default" case this file
          // tests) into the fixture's default — the org override has to be passed through verbatim.
          retentionCompact: opts.org === undefined ? true : opts.org.retentionCompact,
          retentionDigestMonths: opts.org === undefined ? null : opts.org.retentionDigestMonths,
        },
      ]),
    },
    repository: { findMany: vi.fn(async () => [{ id: "repo_1" }]) },
    scan: {
      // Newest-first, then `skip: max` — the same window the production selector pages over.
      findMany: vi.fn(async ({ skip }: { skip?: number; select?: unknown }) =>
        opts.scans
          .filter((s) => alive.has(s.id))
          .sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt))
          .slice(skip ?? 0)
          .map(scanRow),
      ),
      count: vi.fn(async () => [...alive].length),
      groupBy: vi.fn(async () => [{ repoId: "repo_1", _count: { _all: [...alive].length } }]),
    },
    // Rolls the digest table back with the deletes, exactly as a real transaction does.
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => {
      const before = digests.map((d) => ({ ...d }));
      try {
        return await fn(tx);
      } catch (err) {
        digests.length = 0;
        digests.push(...before);
        throw err;
      }
    }),
  };

  return { prisma, digests, alive, scanDigest };
}

describe("purgeExpiredData — compaction (moonshot #32)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    for (const k of ENV_KEYS) delete process.env[k];
    delete process.env.RETENTION_COMPACT;
    delete process.env.RETENTION_DIGEST_MONTHS;
  });
  afterEach(() => {
    delete process.env.RETENTION_COMPACT;
    delete process.env.RETENTION_DIGEST_MONTHS;
    vi.clearAllMocks();
  });

  it("is OFF by default: the page select stays `{ id: true }` and no digest is written", async () => {
    const { prisma, digests } = fakeCompactionPrisma({
      org: { retentionCompact: null, retentionDigestMonths: null },
      scans: [
        { id: "s1", scannedAt: "2026-03-20T00:00:00Z", overallScore: 70 },
        { id: "s2", scannedAt: "2026-03-10T00:00:00Z", overallScore: 60 },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary!.digestsWritten).toBe(0);
    expect(summary!.scansCompacted).toBe(0);
    expect(digests).toEqual([]);
    expect(prisma.scan.findMany.mock.calls[0]![0]!.select).toEqual({ id: true });
  });

  it("folds one digest per (period, rubric, provider) and commits it WITH the delete", async () => {
    const { prisma, digests, alive } = fakeCompactionPrisma({
      scans: [
        { id: "s1", scannedAt: "2026-03-20T00:00:00Z", overallScore: 70 }, // kept (max = 1)
        { id: "s2", scannedAt: "2026-03-10T00:00:00Z", overallScore: 60 },
        { id: "s3", scannedAt: "2026-03-02T00:00:00Z", overallScore: 40 },
        { id: "s4", scannedAt: "2026-02-02T00:00:00Z", overallScore: 30, rubricVersion: "r8" },
        { id: "s5", scannedAt: "2026-02-05T00:00:00Z", overallScore: 20, engineProvider: "gemini" },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    expect(summary!.scansDeleted).toBe(4);
    expect(summary!.scansCompacted).toBe(4);
    // 2026-03/r9/bedrock, 2026-02/r8/bedrock, 2026-02/r9/gemini
    expect(digests).toHaveLength(3);
    expect(summary!.digestsWritten).toBe(3);
    const march = digests.find((d) => d.period === "2026-03")!;
    expect(march.scanCount).toBe(2);
    expect(march.overallSum).toBe(100); // sums, never means
    expect(march.overallMin).toBe(40);
    expect(march.overallMax).toBe(60);
    expect(march.recsOpened).toBe(4); // 2 recs per folded scan
    expect(march.recsClosed).toBe(2);
    // The newest scan itself is untouched — compaction is not a licence to lower the keep-window.
    expect([...alive]).toEqual(["s1"]);
  });

  it("stamps the 'unknown' rubric sentinel rather than a null key column", async () => {
    const { prisma, digests } = fakeCompactionPrisma({
      scans: [
        { id: "s1", scannedAt: "2026-03-20T00:00:00Z", overallScore: 70 },
        { id: "s2", scannedAt: "2026-03-10T00:00:00Z", overallScore: 60, rubricVersion: null },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);
    await purgeExpiredData();
    // Postgres treats NULLs as DISTINCT: a nullable key column would insert a fresh row every tick.
    expect(digests[0]!.rubricVersion).toBe("unknown");
  });

  it("rolls the fold back when the delete throws — a fold outside the transaction would double-count", async () => {
    const { prisma, digests, alive } = fakeCompactionPrisma({
      failDelete: true,
      scans: [
        { id: "s1", scannedAt: "2026-03-20T00:00:00Z", overallScore: 70 },
        { id: "s2", scannedAt: "2026-03-10T00:00:00Z", overallScore: 60 },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData();

    // FAIL-BEFORE: with `upsertDigests` called beside the transaction rather than inside it, the
    // digest survives the aborted delete and the next tick folds the SAME scans into it again.
    expect(digests).toEqual([]);
    expect(summary!.digestsWritten).toBe(0);
    expect([...alive].sort()).toEqual(["s1", "s2"]); // nothing died either
    expect(summary!.errors[0]).toContain("delete exploded");
  });

  it("ages digests out on retentionDigestMonths, and never when it is 0 (keep forever)", async () => {
    const base = fakeCompactionPrisma({
      org: { retentionCompact: true, retentionDigestMonths: 0 },
      scans: [{ id: "s1", scannedAt: "2026-03-20T00:00:00Z", overallScore: 70 }],
    });
    mockGetPrisma.mockReturnValue(base.prisma);
    await purgeExpiredData();
    expect(base.scanDigest.findMany).not.toHaveBeenCalled();

    const aged = fakeCompactionPrisma({
      org: { retentionCompact: true, retentionDigestMonths: 24 },
      scans: [{ id: "s1", scannedAt: "2026-03-20T00:00:00Z", overallScore: 70 }],
    });
    aged.scanDigest.findMany.mockImplementationOnce(async () => [{ id: "dg_old" }]);
    aged.scanDigest.deleteMany.mockImplementationOnce(async () => ({ count: 1 }));
    mockGetPrisma.mockReturnValue(aged.prisma);

    const summary = await purgeExpiredData();

    expect(summary!.digestsDeleted).toBe(1);
    const where = aged.scanDigest.findMany.mock.calls[0]![0] as { where: { lastScannedAt: { lt: Date } } };
    expect(where.where.lastScannedAt.lt).toBeInstanceOf(Date);
  });

  it("dry run reports digestsWouldWrite over the same window — and null past the preview cap", async () => {
    const scans = [
      { id: "s1", scannedAt: "2026-03-20T00:00:00Z", overallScore: 70 },
      { id: "s2", scannedAt: "2026-03-10T00:00:00Z", overallScore: 60 },
      { id: "s3", scannedAt: "2026-02-10T00:00:00Z", overallScore: 60 },
    ];
    const { prisma } = fakeCompactionPrisma({ scans });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData({ dryRun: true });
    expect(summary!.scansDeleted).toBe(2); // 3 − max(1)
    expect(summary!.digestsWouldWrite).toBe(2); // 2026-03 and 2026-02

    // Past the cap the answer is UNKNOWN, never an extrapolation — and the SCAN count stays exact.
    const big = fakeCompactionPrisma({ scans });
    big.prisma.scan.groupBy.mockImplementation(async () => [{ repoId: "repo_1", _count: { _all: 10_001 } }]);
    mockGetPrisma.mockReturnValue(big.prisma);
    const capped = await purgeExpiredData({ dryRun: true });
    expect(capped!.scansDeleted).toBe(10_000);
    expect(capped!.digestsWouldWrite).toBeNull();
  });
});

describe("eraseOrgData — compaction refusal (moonshot #32)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    process.env.RETENTION_COMPACT = "1"; // even with compaction ON deployment-wide
  });
  afterEach(() => {
    delete process.env.RETENTION_COMPACT;
    vi.clearAllMocks();
  });

  it("writes NO digest and deletes the tail that already exists", async () => {
    const { prisma, ledgers } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme" });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // A DSR erase must not mint a summary of the data it is erasing — the fixture's digest delegate
    // has no `create`/`update` at all, so any fold attempt would throw rather than pass quietly.
    expect(outcome.digestsDeleted).toBe(2);
    expect(ledgers.rows.scanDigest).toEqual([]);
    expect(recordAudit).toHaveBeenCalledWith(
      ERASE_ACTION,
      expect.objectContaining({ digestsDeleted: 2 }),
      expect.anything(),
    );
  });

  it("a preview counts the tail over the same predicate and removes nothing", async () => {
    const { prisma, ledgers } = fakeWave1ErasePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const preview = await eraseOrgData({ orgSlug: "acme", dryRun: true });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.digestsDeleted).toBe(2);
    expect(ledgers.rows.scanDigest).toEqual(["dg_1", "dg_2"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MOONSHOT WAVE 3 — the scan queue (#10) and the governance evidence ledger (#1).
//
// Three rules that no schema can express and that therefore live here:
//   1. the queue drains on a FIXED horizon and for EVERY org, including one that configured no
//      retention at all — the per-org loop skips those, so a policy-coupled sweep would let the
//      queue grow forever on the default deployment;
//   2. the control ledger ages out on the audit horizon but ALWAYS keeps the newest row per
//      (repoFullName, controlId) — deleting a pair's last row makes the read layer report
//      `unmeasurable`, i.e. retention manufacturing a governance finding out of a control that has
//      been on the whole time;
//   3. a ControlLedgerSeal is NEVER purged with its rows — a sealed day that keeps its seal after the
//      rows age out is DETECTABLY short, which is the entire point of sealing days.
// Each assertion below names what fails without its line.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

type ObsRow = { id: string; repoFullName: string; controlId: string; observedAt: Date };
type ObsWhere = {
  orgId?: string;
  repoFullName?: string;
  controlId?: string;
  observedAt?: { lt?: Date };
  id?: { in?: string[]; not?: string };
};
type JobRow = { id: string; state: string; settledAt: Date | null };
type JobWhere = { orgId?: string; state?: { in: string[] }; settledAt?: { lt?: Date }; id?: { in?: string[] } };

const DAY = 24 * 60 * 60 * 1000;

/**
 * A purge/erase fixture with ROW-AWARE control-observation and scan-job tables: the pair grouping,
 * the survivor lookup and the date predicates are all evaluated against real rows, so "the newest row
 * of each pair survived" is a fact about the fixture rather than a mock returning what the assertion
 * wants. Everything else is the wave-1 ledger set, empty.
 */
function fakeWave3Prisma(
  opts: {
    observations?: ObsRow[];
    jobs?: JobRow[];
    seals?: string[];
    org?: { retentionMaxScans: number; retentionAuditDays: number };
  } = {},
) {
  const ledgers = makeWave1Ledgers({ controlLedgerSeal: opts.seals ?? ["sl_1", "sl_2"] });
  const obs = [...(opts.observations ?? [])];
  const jobs = [...(opts.jobs ?? [])];

  const obsMatches = (where: ObsWhere, r: ObsRow) =>
    (where.repoFullName === undefined || where.repoFullName === r.repoFullName) &&
    (where.controlId === undefined || where.controlId === r.controlId) &&
    (where.observedAt?.lt === undefined || r.observedAt < where.observedAt.lt) &&
    (where.id?.not === undefined || where.id.not !== r.id) &&
    (where.id?.in === undefined || where.id.in.includes(r.id));

  const controlObservation = {
    groupBy: vi.fn(async () => {
      const seen = new Map<string, { repoFullName: string; controlId: string }>();
      for (const r of obs) seen.set(`${r.repoFullName} ${r.controlId}`, { repoFullName: r.repoFullName, controlId: r.controlId });
      return [...seen.values()];
    }),
    findFirst: vi.fn(async ({ where }: { where: ObsWhere }) => {
      const pair = obs
        .filter((r) => r.repoFullName === where.repoFullName && r.controlId === where.controlId)
        .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime() || (a.id < b.id ? 1 : -1));
      return pair[0] ? { id: pair[0].id } : null;
    }),
    findMany: vi.fn(async ({ where, take }: { where: ObsWhere; take: number }) =>
      obs
        .filter((r) => obsMatches(where, r))
        .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())
        .slice(0, take)
        .map((r) => ({ id: r.id })),
    ),
    count: vi.fn(async ({ where }: { where: ObsWhere }) => obs.filter((r) => obsMatches(where, r)).length),
    deleteMany: vi.fn(async ({ where }: { where: ObsWhere }) => {
      const ids = where.id?.in ?? obs.map((r) => r.id);
      let count = 0;
      for (const id of ids) {
        const at = obs.findIndex((r) => r.id === id);
        if (at >= 0) {
          obs.splice(at, 1);
          count++;
        }
      }
      return { count };
    }),
  };

  const jobMatches = (where: JobWhere, r: JobRow) =>
    (where.state === undefined || where.state.in.includes(r.state)) &&
    (where.settledAt?.lt === undefined || (r.settledAt !== null && r.settledAt < where.settledAt.lt)) &&
    (where.id?.in === undefined || where.id.in.includes(r.id));

  const scanJob = {
    findMany: vi.fn(async ({ where, take }: { where: JobWhere; take: number }) =>
      jobs.filter((r) => jobMatches(where, r)).slice(0, take).map((r) => ({ id: r.id })),
    ),
    count: vi.fn(async ({ where }: { where: JobWhere }) => jobs.filter((r) => jobMatches(where, r)).length),
    deleteMany: vi.fn(async ({ where }: { where: JobWhere }) => {
      const ids = where.id?.in ?? jobs.map((r) => r.id);
      let count = 0;
      for (const id of ids) {
        const at = jobs.findIndex((r) => r.id === id);
        if (at >= 0) {
          jobs.splice(at, 1);
          count++;
        }
      }
      return { count };
    }),
  };

  const tx = {
    ...ledgers.delegates,
    controlObservation,
    scanJob,
    recommendation: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    recommendationEvent: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    scanDimension: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    scan: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    loopRunLane: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    loopRun: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    athenaProposal: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    athenaTurn: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    athenaThread: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  };

  const orgPolicy = opts.org ?? { retentionMaxScans: 5, retentionAuditDays: 30 };
  const prisma = {
    ...ledgers.delegates,
    controlObservation,
    scanJob,
    organization: {
      findMany: vi.fn(async () => [{ id: "org_1", slug: "acme", ...orgPolicy }]),
      findUnique: vi.fn(async () => ({ id: "org_1" })),
    },
    repository: {
      findMany: vi.fn(async () => [{ id: "repo_1" }]),
      findUnique: vi.fn(async () => ({ id: "repo_1" })),
      update: vi.fn(async () => ({ id: "repo_1" })),
    },
    scan: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      groupBy: vi.fn(async () => [{ repoId: "repo_1", _count: { _all: 0 } }]),
    },
    loopRun: { findMany: vi.fn(async () => []) },
    loopRunLane: { count: vi.fn(async () => 0) },
    athenaThread: { findMany: vi.fn(async () => []) },
    athenaTurn: { count: vi.fn(async () => 0) },
    athenaProposal: { count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })) },
    athenaIdentity: { count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })) },
    orgMemory: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })) },
    auditLog: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), deleteMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, ledgers, obs, jobs };
}

/** Two repos × one control, three observations each: two aged, one fresh. */
function agedObservations(now: number): ObsRow[] {
  const at = (days: number) => new Date(now - days * DAY);
  return [
    { id: "co_a1", repoFullName: "acme/api", controlId: "branch-protection", observedAt: at(120) },
    { id: "co_a2", repoFullName: "acme/api", controlId: "branch-protection", observedAt: at(90) },
    { id: "co_a3", repoFullName: "acme/api", controlId: "branch-protection", observedAt: at(60) },
    { id: "co_b1", repoFullName: "acme/web", controlId: "required-reviews", observedAt: at(200) },
    { id: "co_b2", repoFullName: "acme/web", controlId: "required-reviews", observedAt: at(150) },
  ];
}

describe("purgeExpiredData — moonshot wave-3 control ledger (#1)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    vi.mocked(recordAudit).mockResolvedValue(true);
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => vi.clearAllMocks());

  // FAIL-BEFORE: with a plain `observedAt < cutoff` sweep (no per-pair survivor exclusion), acme/web
  // loses BOTH its rows — every observation of that control is older than the window — and the
  // posture read, finding nothing, reports `unmeasurable`. Retention would have invented a
  // governance finding for a control that was observed passing and never changed.
  it("ages observations out on the audit horizon but keeps the newest of every (repo, control) pair", async () => {
    const now = Date.UTC(2026, 7, 30);
    const { prisma, obs } = fakeWave3Prisma({ observations: agedObservations(now) });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData({ now: () => now });

    // acme/api: co_a1 + co_a2 die, co_a3 survives. acme/web: co_b1 dies, co_b2 survives although it
    // is itself well past the cutoff — being the pair's newest outranks the horizon.
    expect(obs.map((r) => r.id).sort()).toEqual(["co_a3", "co_b2"]);
    expect(summary?.controlObservationsDeleted).toBe(3);
    // The survivor is excluded in the PREDICATE, not filtered out of a selected page — a page that
    // happened to be all survivors would otherwise end the sweep early and silently.
    const where = prisma.controlObservation.findMany.mock.calls[0]![0].where;
    expect(where.orgId).toBe("org_1");
    expect(where.observedAt?.lt).toBeInstanceOf(Date);
    expect(where.id?.not).toBeTruthy();
  });

  // FAIL-BEFORE: without the ControlLedgerSeal exception, the seals age out beside their rows and a
  // shortened evidence window becomes indistinguishable from a day on which nothing happened. The
  // seal surviving is what makes the deletion detectable — its root no longer reproduces.
  it("never purges a ControlLedgerSeal with its rows", async () => {
    const now = Date.UTC(2026, 7, 30);
    const { prisma, ledgers } = fakeWave3Prisma({ observations: agedObservations(now), seals: ["sl_1", "sl_2"] });
    mockGetPrisma.mockReturnValue(prisma);

    await purgeExpiredData({ now: () => now });

    expect(ledgers.rows.controlLedgerSeal).toEqual(["sl_1", "sl_2"]);
    expect(prisma.controlLedgerSeal.deleteMany).not.toHaveBeenCalled();
  });

  // FAIL-BEFORE: a preview that reported 0 while the confirmed run destroyed three rows of
  // governance evidence is the number a human reads before approving the purge.
  it("counts the same rows in a dry run and deletes nothing", async () => {
    const now = Date.UTC(2026, 7, 30);
    const { prisma, obs } = fakeWave3Prisma({ observations: agedObservations(now) });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData({ dryRun: true, now: () => now });

    expect(summary?.controlObservationsDeleted).toBe(3);
    expect(obs).toHaveLength(5);
    expect(prisma.controlObservation.deleteMany).not.toHaveBeenCalled();
  });

  // FAIL-BEFORE: the floor is what stops a fat-fingered `retentionAuditDays = 1` from taking an org's
  // whole control ledger on the next tick. It applies here for free ONLY because the sweep sits under
  // the same per-org gate as the audit trail — a sweep hoisted out of it would lose the floor.
  it("refuses a sub-floor audit window rather than sweeping the ledger", async () => {
    const now = Date.UTC(2026, 7, 30);
    const { prisma, obs } = fakeWave3Prisma({
      observations: agedObservations(now),
      org: { retentionMaxScans: 10, retentionAuditDays: RETENTION_MIN_AUDIT_DAYS - 1 },
    });
    mockGetPrisma.mockReturnValue(prisma);
    delete process.env.RETENTION_FORCE;

    const summary = await purgeExpiredData({ now: () => now });

    expect(obs).toHaveLength(5);
    expect(summary?.controlObservationsDeleted).toBe(0);
    expect(summary?.errors.join(" ")).toContain("below the safety floor");
  });
});

describe("purgeExpiredData — moonshot wave-3 scan queue (#10)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    vi.mocked(recordAudit).mockResolvedValue(true);
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => vi.clearAllMocks());

  /** Settled rows either side of the horizon, plus live work that must never be swept. */
  function queue(now: number): JobRow[] {
    const at = (days: number) => new Date(now - days * DAY);
    return [
      { id: "sj_done_old", state: "done", settledAt: at(SCAN_JOB_RETENTION_DAYS + 5) },
      { id: "sj_failed_old", state: "failed", settledAt: at(SCAN_JOB_RETENTION_DAYS + 1) },
      { id: "sj_skipped_old", state: "skipped", settledAt: at(400) },
      { id: "sj_done_fresh", state: "done", settledAt: at(2) },
      { id: "sj_queued", state: "queued", settledAt: null },
      { id: "sj_claimed", state: "claimed", settledAt: null },
    ];
  }

  // FAIL-BEFORE: without the sweep the queue is bounded by nothing — a job row is not a scan child,
  // so the scan prune can never reach it. And without the state filter the sweep would take LIVE
  // work: a queued job deleted on age is a scan that silently never happens.
  it("retires settled rows past the 30-day horizon and never touches queued or claimed work", async () => {
    const now = Date.UTC(2026, 7, 30);
    const { prisma, jobs } = fakeWave3Prisma({ jobs: queue(now) });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData({ now: () => now });

    expect(summary?.scanJobsDeleted).toBe(3);
    expect(jobs.map((r) => r.id).sort()).toEqual(["sj_claimed", "sj_done_fresh", "sj_queued"]);
    const where = prisma.scanJob.findMany.mock.calls[0]![0].where;
    expect(where.state).toEqual({ in: [...SCAN_JOB_SETTLED_STATES] });
    expect(where.settledAt.lt.getTime()).toBe(now - SCAN_JOB_RETENTION_DAYS * DAY);
    expect(recordAudit).toHaveBeenCalledWith(
      "retention.purged",
      expect.objectContaining({ scope: "scan-queue", scanJobsDeleted: 3 }),
      expect.anything(),
    );
  });

  // FAIL-BEFORE: this is why the sweep is fleet-wide instead of a per-org branch. Retention is
  // opt-in, so an org with both windows at 0 is skipped by the org loop entirely — a policy-coupled
  // queue sweep would therefore never run at all on the default deployment.
  it("drains the queue for an org that has configured NO retention policy", async () => {
    const now = Date.UTC(2026, 7, 30);
    const { prisma, jobs } = fakeWave3Prisma({
      jobs: queue(now),
      org: { retentionMaxScans: 0, retentionAuditDays: 0 },
    });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData({ now: () => now });

    // The org contributed no result row (nothing to enforce), and the queue still drained.
    expect(summary?.orgsProcessed).toBe(0);
    expect(summary?.scanJobsDeleted).toBe(3);
    expect(jobs).toHaveLength(3);
  });

  it("counts the queue in a dry run and deletes nothing", async () => {
    const now = Date.UTC(2026, 7, 30);
    const { prisma, jobs } = fakeWave3Prisma({ jobs: queue(now) });
    mockGetPrisma.mockReturnValue(prisma);

    const summary = await purgeExpiredData({ dryRun: true, now: () => now });

    expect(summary?.scanJobsDeleted).toBe(3);
    expect(jobs).toHaveLength(6);
    expect(prisma.scanJob.deleteMany).not.toHaveBeenCalled();
  });
});

describe("eraseOrgData — moonshot wave-3 cascades (#10, #1)", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
    mockIsDbConfigured.mockReset();
    mockIsDbConfigured.mockReturnValue(true);
    vi.mocked(recordAudit).mockResolvedValue(true);
    delete process.env[ERASE_AUDIT_FORCE_ENV];
  });
  afterEach(() => vi.clearAllMocks());

  // FAIL-BEFORE: without the three wave-3 drains an "erasure" leaves behind queued work naming the
  // tenant's repositories (which the worker would then go and scan), the current posture of every
  // control on every repo it owns, and a per-day row count for every day it operated.
  it("erases the whole queue, every observation INCLUDING each pair's newest, and the seals", async () => {
    const now = Date.UTC(2026, 7, 30);
    const { prisma, ledgers, obs, jobs } = fakeWave3Prisma({
      observations: agedObservations(now),
      jobs: [
        { id: "sj_queued", state: "queued", settledAt: null },
        { id: "sj_done_fresh", state: "done", settledAt: new Date(now - DAY) },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const outcome = await eraseOrgData({ orgSlug: "acme", now: () => now });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.scanJobsDeleted).toBe(2);
    expect(outcome.controlObservationsDeleted).toBe(5);
    expect(outcome.controlSealsDeleted).toBe(2);
    expect(jobs).toEqual([]);
    expect(obs).toEqual([]);
    expect(ledgers.rows.controlLedgerSeal).toEqual([]);
    // Org-scoped, never a bare deleteMany over the whole table (this is a multi-tenant store) — and
    // with no date predicate: an erasure keeps nothing, so the purge's keep-newest rule is absent.
    for (const name of ["scanJob", "controlObservation", "controlLedgerSeal"] as const) {
      expect(prisma[name].findMany.mock.calls[0]![0].where).toEqual({ orgId: "org_1" });
    }
    expect(recordAudit).toHaveBeenCalledWith(
      ERASE_ACTION,
      expect.objectContaining({ scanJobsDeleted: 2, controlObservationsDeleted: 5, controlSealsDeleted: 2 }),
      expect.anything(),
    );
  });

  it("a preview counts all three over the delete's own predicate and removes nothing", async () => {
    const now = Date.UTC(2026, 7, 30);
    const { prisma, ledgers, obs, jobs } = fakeWave3Prisma({
      observations: agedObservations(now),
      jobs: [{ id: "sj_queued", state: "queued", settledAt: null }],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const preview = await eraseOrgData({ orgSlug: "acme", dryRun: true, now: () => now });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.scanJobsDeleted).toBe(1);
    expect(preview.controlObservationsDeleted).toBe(5);
    expect(preview.controlSealsDeleted).toBe(2);
    expect(jobs).toHaveLength(1);
    expect(obs).toHaveLength(5);
    expect(ledgers.rows.controlLedgerSeal).toEqual(["sl_1", "sl_2"]);
  });
});
