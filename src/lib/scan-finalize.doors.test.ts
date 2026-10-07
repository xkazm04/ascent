// cacheAndPersistScan's two best-effort reads — the regression BASELINE (getScanReportByCommit before
// the persist) and the org identity (getOrgId after it) — degrade by design: a failed baseline is a null
// `prev` (first-scan no-op diff), a failed org read is `orgId: undefined`. Neither may fail the scan.
// The door sweep kept those fallbacks and gave each catch a door (degradeTo → console.warn + telemetry
// naming the read, prefixed with the caller's tag). Pinned: the scan still persists and is durable, the
// downstream consumers see the degraded value, and reportHandledError fired with the original error.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScanReport } from "@/lib/types";
import type { ScanResultClass } from "./scan-finalize";

vi.mock("@/lib/cache", () => ({ cacheSet: vi.fn() }));
vi.mock("@/lib/scan-alerts", () => ({ checkAndAlertRegression: vi.fn() }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  persistScanReport: vi.fn(),
  getScanReportByCommit: vi.fn(),
  getOrgId: vi.fn(),
}));
// Imported by the module for consumeScanQuota (not under test here), so they must resolve — stub them.
vi.mock("@/lib/public-scan-quota", () => ({
  consumePublicScanQuota: vi.fn(),
  refundPublicScanQuota: vi.fn(),
  monthlyQuotaExceeded: vi.fn(),
}));
vi.mock("@/lib/access", () => ({ getViewer: vi.fn() }));
// The post-persist consumers — stubbed so the degraded prev / orgId they receive is observable.
vi.mock("@/lib/memory/scan-feed", () => ({ recordScanMemories: vi.fn() }));
vi.mock("@/lib/db/practice-adoption", () => ({ reconcilePracticeAdoption: vi.fn() }));
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  reportHandledError: vi.fn(),
}));

import { cacheAndPersistScan } from "./scan-finalize";
import { checkAndAlertRegression } from "@/lib/scan-alerts";
import { getScanReportByCommit, getOrgId, persistScanReport, isDbConfigured } from "@/lib/db";
import { recordScanMemories } from "@/lib/memory/scan-feed";
import { reconcilePracticeAdoption } from "@/lib/db/practice-adoption";
import { reportHandledError } from "@/lib/api/respond";

const mockCheck = vi.mocked(checkAndAlertRegression);
const mockPrev = vi.mocked(getScanReportByCommit);
const mockOrgId = vi.mocked(getOrgId);
const mockPersist = vi.mocked(persistScanReport);
const mockDbConfigured = vi.mocked(isDbConfigured);
const mockMemories = vi.mocked(recordScanMemories);
const mockReconcile = vi.mocked(reconcilePracticeAdoption);
const mockReport = vi.mocked(reportHandledError);

// Only repo.{owner,name,headSha} / engine.provider / confidence are read here; a minimal cast suffices.
function report(): ScanReport {
  return { repo: { owner: "acme", name: "api", headSha: "sha-fresh" }, engine: { provider: "gemini" }, confidence: 1 } as unknown as ScanReport;
}
const prevReport = { repo: { owner: "acme", name: "api", headSha: "sha-old" } } as unknown as ScanReport;

const AUTHORITATIVE: ScanResultClass = { degradedToMock: false, lowCoverage: false, partialPrSlice: false };
const OPTS = { tag: "scan/stream", repo: "acme/api", orgSlug: "acme", lookup: null } as const;
const NEW_ROW = { scanId: "s1", deduped: false, headSha: "sha-fresh", failures: { audit: false, contributors: 0 } };
const OUTCOME = { regressed: false, verdict: null, dispatched: false };

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockDbConfigured.mockReturnValue(true);
  mockPrev.mockResolvedValue(prevReport as never);
  mockOrgId.mockResolvedValue("org_acme");
  mockPersist.mockResolvedValue(NEW_ROW as never);
  mockCheck.mockResolvedValue(OUTCOME);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe("cacheAndPersistScan — regression-baseline door (getScanReportByCommit catch)", () => {
  it("a thrown baseline read degrades to prev=null, the scan still lands, and the door names the read", async () => {
    const boom = new Error("baseline read blip");
    mockPrev.mockRejectedValueOnce(boom);
    const fresh = report();

    const out = await cacheAndPersistScan(fresh, AUTHORITATIVE, { ...OPTS });

    // Degraded behaviour unchanged: persisted, durable, and both consumers diff against a null baseline.
    expect(out).toEqual({ deduped: false, persistedOk: true, durable: true });
    expect(mockPersist).toHaveBeenCalledTimes(1);
    expect(mockCheck).toHaveBeenCalledWith(null, fresh, { orgId: "org_acme", orgSlug: "acme" });
    expect(mockMemories).toHaveBeenCalledWith("org_acme", null, fresh, OUTCOME);

    // The door: the caller's tag + the read name, carrying the original error.
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport).toHaveBeenCalledWith(boom, {
      message: expect.stringContaining("scan/stream: regression baseline (getScanReportByCommit)"),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("regression baseline"), boom);
  });
});

describe("cacheAndPersistScan — org-identity door (getOrgId catch)", () => {
  it("a thrown getOrgId degrades to orgId undefined (no adoption reconcile), the alert still runs, the door fires", async () => {
    const boom = new Error("org lookup down");
    mockOrgId.mockRejectedValueOnce(boom);
    const fresh = report();

    const out = await cacheAndPersistScan(fresh, AUTHORITATIVE, { ...OPTS });

    expect(out).toEqual({ deduped: false, persistedOk: true, durable: true });
    // Same shape as a resolved-null org: the reconcile is skipped, the check runs org-less.
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockCheck).toHaveBeenCalledWith(prevReport, fresh, { orgId: undefined, orgSlug: "acme" });
    expect(mockMemories).toHaveBeenCalledWith(undefined, prevReport, fresh, OUTCOME);

    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport).toHaveBeenCalledWith(boom, { message: expect.stringContaining("scan/stream: getOrgId") });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("scan/stream: getOrgId"), boom);
  });

  it("both reads healthy → no door (the happy path stays quiet)", async () => {
    await cacheAndPersistScan(report(), AUTHORITATIVE, { ...OPTS });

    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockReport).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
