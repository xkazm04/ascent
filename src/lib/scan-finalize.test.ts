// Tests for the INTERACTIVE regression alert wiring (DIRECTION 4). checkAndAlertRegression was
// consumed only by the cron autoscan + push webhook; a user's manual rescan through /api/scan or
// /api/scan/stream that regressed alerted no one. Both routes flow through cacheAndPersistScan, so the
// check is wired ONCE there, after a successful (authoritative, new-row) persist. These tests pin:
//   - a fresh authoritative scan fires the check with the pre-persist baseline + resolved org identity,
//   - a dedup / non-authoritative (degraded) report does NOT fire it,
//   - and an alert failure is swallowed (it must never fail an already-persisted scan).
// Everything below cacheAndPersistScan (persist, the diff/detector, the cooldown claim) is mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { cacheAndPersistScan } from "./scan-finalize";
import { checkAndAlertRegression } from "@/lib/scan-alerts";
import { getScanReportByCommit, getOrgId, persistScanReport, isDbConfigured } from "@/lib/db";

const mockCheck = vi.mocked(checkAndAlertRegression);
const mockPrev = vi.mocked(getScanReportByCommit);
const mockOrgId = vi.mocked(getOrgId);
const mockPersist = vi.mocked(persistScanReport);
const mockDbConfigured = vi.mocked(isDbConfigured);

// Only repo.{owner,name,headSha} / engine.provider / confidence are read here; a minimal cast suffices.
function report(owner = "acme", name = "api"): ScanReport {
  return { repo: { owner, name, headSha: "sha-fresh" }, engine: { provider: "gemini" }, confidence: 1 } as unknown as ScanReport;
}
const prevReport = { repo: { owner: "acme", name: "api", headSha: "sha-old" } } as unknown as ScanReport;

const AUTHORITATIVE: ScanResultClass = { degradedToMock: false, lowCoverage: false, partialPrSlice: false };
const DEGRADED: ScanResultClass = { degradedToMock: true, lowCoverage: false, partialPrSlice: false };
const OPTS = { tag: "scan", repo: "acme/api", orgSlug: "acme", lookup: null } as const;

function persisted(deduped: boolean) {
  return { scanId: "s1", deduped, headSha: "sha-fresh", failures: { audit: false, contributors: 0 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbConfigured.mockReturnValue(true);
  mockPrev.mockResolvedValue(prevReport as never);
  mockOrgId.mockResolvedValue("org_acme");
  mockCheck.mockResolvedValue({ regressed: false, verdict: null, dispatched: false });
});

describe("cacheAndPersistScan — interactive regression alert wiring", () => {
  it("fires checkAndAlertRegression after a NEW authoritative persist, with the pre-persist baseline + org identity", async () => {
    mockPersist.mockResolvedValue(persisted(false) as never);
    const fresh = report();

    const out = await cacheAndPersistScan(fresh, AUTHORITATIVE, { ...OPTS });

    expect(out).toEqual({ deduped: false, persistedOk: true });
    // Baseline was read for THIS repo+org (the diff target)...
    expect(mockPrev).toHaveBeenCalledWith("acme", "api", { orgSlug: "acme" });
    // ...and the check ran once with (prev, freshReport, {orgId, orgSlug}) — mirroring cron/webhook.
    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(mockCheck).toHaveBeenCalledWith(prevReport, fresh, { orgId: "org_acme", orgSlug: "acme" });
  });

  it("captures the baseline BEFORE persisting the fresh scan (order matters for the diff)", async () => {
    const order: string[] = [];
    mockPrev.mockImplementation(async () => {
      order.push("read-prev");
      return prevReport as never;
    });
    mockPersist.mockImplementation(async () => {
      order.push("persist");
      return persisted(false) as never;
    });

    await cacheAndPersistScan(report(), AUTHORITATIVE, { ...OPTS });

    expect(order).toEqual(["read-prev", "persist"]);
  });

  it("does NOT fire the check on a dedup (unchanged commit — no new scored row)", async () => {
    mockPersist.mockResolvedValue(persisted(true) as never);

    const out = await cacheAndPersistScan(report(), AUTHORITATIVE, { ...OPTS });

    expect(out.deduped).toBe(true);
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("does NOT persist NOR fire the check on a non-authoritative (degraded) report", async () => {
    const out = await cacheAndPersistScan(report(), DEGRADED, { ...OPTS });

    expect(out).toEqual({ deduped: false, persistedOk: true });
    expect(mockPersist).not.toHaveBeenCalled();
    expect(mockPrev).not.toHaveBeenCalled();
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it("SWALLOWS an alert failure — a throwing check must never fail the already-persisted scan", async () => {
    mockPersist.mockResolvedValue(persisted(false) as never);
    // Even though the real checkAndAlertRegression never throws, defend the persisted-scan path against it.
    mockCheck.mockRejectedValue(new Error("alert layer blew up"));

    await expect(cacheAndPersistScan(report(), AUTHORITATIVE, { ...OPTS })).resolves.toEqual({
      deduped: false,
      persistedOk: true,
    });
  });

  it("still fires with a NULL baseline when the pre-persist read fails (best-effort baseline)", async () => {
    mockPrev.mockRejectedValue(new Error("db read blip"));
    mockPersist.mockResolvedValue(persisted(false) as never);
    const fresh = report();

    await cacheAndPersistScan(fresh, AUTHORITATIVE, { ...OPTS });

    expect(mockCheck).toHaveBeenCalledWith(null, fresh, { orgId: "org_acme", orgSlug: "acme" });
  });

  it("passes orgId undefined when the org can't be resolved (getOrgId returns null)", async () => {
    mockOrgId.mockResolvedValue(null);
    mockPersist.mockResolvedValue(persisted(false) as never);
    const fresh = report();

    await cacheAndPersistScan(fresh, AUTHORITATIVE, { ...OPTS });

    expect(mockCheck).toHaveBeenCalledWith(prevReport, fresh, { orgId: undefined, orgSlug: "acme" });
  });
});
