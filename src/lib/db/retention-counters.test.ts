// @vitest-environment node
//
// One counter list drives the result row, the self-audit meta, the run rollup and the orphan row;
// and committed batches keep their counts when a LATER batch throws (registry data-retention
// deviation: the scan prune used to report its counts only once the whole repo had returned).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CUTOFF, NOW, before, createPurgeStore, straddlingSeed, type FakeRow } from "./retention-purge.fixture";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/client")>("@/lib/db/client");
  return { ...actual, getPrisma: mockGetPrisma, isDbConfigured: () => true };
});
vi.mock("@/lib/db/scans", () => ({ recordAudit: vi.fn(async () => true) }));
vi.mock("@/lib/public-scan-quota", () => ({ purgeStalePublicScanQuota: vi.fn(async () => 0) }));

import { purgeExpiredData } from "./retention";
import { PURGE_COUNTER_KEYS, auditMeta, rollupCounters, sumDeleted, zeroCounters, zeroOrgResult } from "./retention-counters";
import { recordAudit } from "@/lib/db/scans";

const POLICY = { maxScansPerRepo: 0, auditDays: 30, batchSize: 500 };
const sortedKeys = (o: object) => Object.keys(o).sort();
const COUNTERS = [...PURGE_COUNTER_KEYS].sort();

beforeEach(() => {
  process.env.RETENTION_FORCE = "1";
  vi.mocked(recordAudit).mockClear();
});
afterEach(() => {
  delete process.env.RETENTION_FORCE;
  delete process.env.RETENTION_BATCH_SIZE;
  delete process.env.RETENTION_AUDIT_DAYS;
});

describe("PURGE_COUNTER_KEYS is the one list", () => {
  it("zeroOrgResult carries every key at 0, beside the three non-counter fields", () => {
    const row = zeroOrgResult("acme", POLICY);
    expect(sortedKeys(row)).toEqual([...COUNTERS, "digestsWouldWrite", "orgSlug", "policy"].sort());
    for (const k of PURGE_COUNTER_KEYS) expect(row[k]).toBe(0);
    expect(row.digestsWouldWrite).toBeNull();
  });

  it("sumDeleted counts deletions only: a fold (digestsWritten, scansCompacted) is not a deletion", () => {
    const c = { ...zeroCounters(), digestsWritten: 4, scansCompacted: 4 };
    expect(sumDeleted(c)).toBe(0);
    expect(sumDeleted({ ...c, digestsDeleted: 1, usageEventsDeleted: 2 })).toBe(3);
  });

  it("every key reaches the retention.purged audit meta of a real run and the PurgeSummary rollup", async () => {
    mockGetPrisma.mockReturnValue(createPurgeStore(straddlingSeed()).prisma);
    const summary = (await purgeExpiredData({ onlyOrgSlug: "acme", now: () => NOW }))!;
    const meta = vi.mocked(recordAudit).mock.calls[0]![1] as Record<string, unknown>;
    expect(sortedKeys(meta)).toEqual([...COUNTERS, "policy"].sort());
    expect(meta).toEqual(auditMeta(summary.results[0]!, summary.results[0]!.policy));
    for (const k of PURGE_COUNTER_KEYS) expect(typeof summary[k]).toBe("number");
    expect(rollupCounters(summary.results)).toEqual(
      Object.fromEntries(PURGE_COUNTER_KEYS.map((k) => [k, summary[k]])),
    );
  });

  it("the orphan sweep's row is the scope rule's zeros overlaid with auditDeleted", async () => {
    process.env.RETENTION_AUDIT_DAYS = "30";
    const seed = straddlingSeed();
    seed.organization = [];
    seed.auditLog = [{ id: "al_orphan", orgId: null, at: before(1) } as unknown as FakeRow];
    mockGetPrisma.mockReturnValue(createPurgeStore(seed).prisma);
    const summary = (await purgeExpiredData({ now: () => NOW }))!;
    const orphan = summary.results.find((r) => r.orgSlug === "(orphan)")!;
    expect(sortedKeys(orphan)).toEqual([...COUNTERS, "digestsWouldWrite", "orgSlug", "policy"].sort());
    expect(orphan).toEqual({ ...zeroOrgResult("(orphan)", orphan.policy), auditDeleted: 1 });
  });
});

/** One repo with `n` scans (one dimension each), newest by createdAt kept by a 5-scan window. */
function scanSeed(n: number): Record<string, FakeRow[]> {
  const scans: FakeRow[] = [];
  const dims: FakeRow[] = [];
  for (let i = 0; i < n; i++) {
    const id = `s_${String(i).padStart(5, "0")}`;
    scans.push({ id, repoId: "r_1", createdAt: new Date(CUTOFF.getTime() + i * 1000) });
    dims.push({ id: `d_${id}`, scanId: id });
  }
  return {
    organization: [{ id: "org_1", slug: "acme", retentionMaxScans: 5, retentionAuditDays: 0, retentionCompact: null, retentionDigestMonths: null, createdAt: before(900) }],
    repository: [{ id: "r_1", orgId: "org_1" }],
    scan: scans,
    scanDimension: dims,
  };
}

describe("committed batches keep their counts when a later batch throws", () => {
  it("the scan prune reports 1000 scans (and their dimensions) when the 3rd 500-row batch throws", async () => {
    const store = createPurgeStore(scanSeed(1505));
    store.failOn("$", "transaction", 3);
    mockGetPrisma.mockReturnValue(store.prisma);
    const summary = (await purgeExpiredData({ onlyOrgSlug: "acme", now: () => NOW }))!;
    expect(store.rows("scan")).toHaveLength(505);
    const row = summary.results.find((r) => r.orgSlug === "acme");
    expect(row).toMatchObject({ scansDeleted: 1000, dimensionsDeleted: 1000 });
    expect(summary.scansDeleted).toBe(1000);
    expect(summary.errors.some((e) => e.startsWith("acme:"))).toBe(true);
  });

  it("the usage-event sweep keeps its first committed batch when the second throws", async () => {
    process.env.RETENTION_BATCH_SIZE = "2";
    const seed = straddlingSeed();
    seed.usageEvent = ["u1", "u2", "u3"].map((id) => ({ id, orgId: "org_1", createdAt: before(1) }));
    seed.auditLog = [];
    const store = createPurgeStore(seed);
    store.failOn("usageEvent", "deleteMany", 2);
    mockGetPrisma.mockReturnValue(store.prisma);
    const summary = (await purgeExpiredData({ onlyOrgSlug: "acme", now: () => NOW }))!;
    expect(store.rows("usageEvent")).toHaveLength(1);
    expect(summary.results.find((r) => r.orgSlug === "acme")?.usageEventsDeleted).toBe(2);
    expect(summary.usageEventsDeleted).toBe(2);
    expect(summary.errors.some((e) => e.startsWith("acme:"))).toBe(true);
  });
});
