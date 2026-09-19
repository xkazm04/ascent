import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma, mockIsDbConfigured } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockIsDbConfigured: vi.fn(),
}));

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

import {
  getOrgRetention,
  previewOrgRetention,
  purgeExpiredData,
  setOrgRetention,
  RETENTION_MIN_AUDIT_DAYS,
  RETENTION_MIN_SCANS_PER_REPO,
} from "./retention";

const COLUMNS = {
  retentionMaxScans: 10,
  retentionAuditDays: 30,
  retentionCompact: true,
  retentionDigestMonths: 12,
};

beforeEach(() => {
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
  delete process.env.RETENTION_FORCE;
  delete process.env.RETENTION_MAX_SCANS_PER_REPO;
  delete process.env.RETENTION_AUDIT_DAYS;
  delete process.env.RETENTION_COMPACT;
  delete process.env.RETENTION_DIGEST_MONTHS;
});
afterEach(() => vi.clearAllMocks());

describe("getOrgRetention / setOrgRetention", () => {
  it("reads all four columns", async () => {
    const findUnique = vi.fn(async () => COLUMNS);
    mockGetPrisma.mockReturnValue({ organization: { findUnique } });
    const view = await getOrgRetention("Acme");
    expect(findUnique).toHaveBeenCalledWith({
      where: { slug: "acme" },
      select: {
        retentionMaxScans: true,
        retentionAuditDays: true,
        retentionCompact: true,
        retentionDigestMonths: true,
      },
    });
    expect(view?.stored).toEqual(COLUMNS);
    expect(view?.effective.maxScansPerRepo).toBe(10);
    expect(view?.floors).toEqual({
      maxScansPerRepo: RETENTION_MIN_SCANS_PER_REPO,
      auditDays: RETENTION_MIN_AUDIT_DAYS,
    });
  });

  it("refuses a sub-floor write and never updates", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockGetPrisma.mockReturnValue({ organization: { updateMany } });
    const res = await setOrgRetention("acme", { ...COLUMNS, retentionMaxScans: 1 });
    expect(res).toMatchObject({ ok: false, reason: "below-floor" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("writes all four columns, including inherit and unlimited", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockGetPrisma.mockReturnValue({ organization: { updateMany } });
    const stored = {
      retentionMaxScans: 0,
      retentionAuditDays: null,
      retentionCompact: null,
      retentionDigestMonths: 0,
    };
    const res = await setOrgRetention("acme", stored);
    expect(res.ok).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { slug: "acme" },
      data: stored,
    });
  });
});

describe("previewOrgRetention", () => {
  it("dry-runs the proposed policy for one org and skips fleet sweeps", async () => {
    const groupBy = vi.fn(async () => [{ repoId: "r1", _count: { _all: 8 } }]);
    const scanFindMany = vi.fn(async () => []);
    const orgFindMany = vi.fn(async () => [{ id: "org_1", slug: "acme", ...COLUMNS }]);
    const scanJobCount = vi.fn(async () => 9);
    mockGetPrisma.mockReturnValue({
      organization: { findMany: orgFindMany },
      scan: { groupBy, findMany: scanFindMany },
      scanJob: { count: scanJobCount },
      $transaction: vi.fn(),
    });

    const summary = await previewOrgRetention("acme", {
      retentionMaxScans: RETENTION_MIN_SCANS_PER_REPO,
      retentionAuditDays: 0,
      retentionCompact: false,
      retentionDigestMonths: 0,
    });

    expect(summary?.dryRun).toBe(true);
    expect(orgFindMany.mock.calls[0]![0].where).toEqual({ slug: "acme" });
    expect(summary?.results[0]?.scansDeleted).toBe(8 - RETENTION_MIN_SCANS_PER_REPO);
    expect(scanJobCount).not.toHaveBeenCalled();
    expect(summary?.results.some((r) => r.orgSlug === "(orphan)")).toBe(false);
  });

  it("does not apply proposed columns on a real (non-dry-run) purge", async () => {
    const orgFindMany = vi.fn(async () => [
      { id: "org_1", slug: "acme", retentionMaxScans: 1, retentionAuditDays: 0, retentionCompact: null, retentionDigestMonths: null },
    ]);
    const groupBy = vi.fn();
    mockGetPrisma.mockReturnValue({
      organization: { findMany: orgFindMany },
      scan: { groupBy, findMany: vi.fn() },
      scanJob: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
      $transaction: vi.fn(),
    });

    const summary = await purgeExpiredData({
      proposed: {
        retentionMaxScans: RETENTION_MIN_SCANS_PER_REPO,
        retentionAuditDays: 0,
        retentionCompact: false,
        retentionDigestMonths: 0,
      },
    });

    expect(summary?.errors[0]).toMatch(/safety floor/);
    expect(groupBy).not.toHaveBeenCalled();
  });
});
