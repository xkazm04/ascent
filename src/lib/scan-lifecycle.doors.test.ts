// latestPublicReport is the any-commit SALVAGE read shared by the peek probe and the failed-scan
// fallback on both scan entry points. It is best-effort by contract: a DB blip yields null (the caller
// shows its own error / scans) — that fallback must not change. The door sweep made the failure
// visible: the catch is degradeTo, so a thrown read reaches console.warn + telemetry naming the read.
// Pinned directly and through salvageScanFailure (the path a user actually hits on a failed scan).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScanReport } from "@/lib/types";

// Same module-level stubs as scan-lifecycle.test.ts, so importing the lifecycle stays inert.
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/scan-cache", () => ({
  lookupCachedScan: vi.fn(),
  lookupScopedScan: vi.fn(),
  resolveHeadWithHint: vi.fn(async () => null),
}));
vi.mock("@/lib/cache", () => ({ cacheSet: vi.fn(), coalesceScan: vi.fn() }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => false),
  persistScanReport: vi.fn(async () => ({ deduped: false })),
  getScanReportByCommit: vi.fn(async () => null),
  getOrgId: vi.fn(async () => null),
  recordQuotaEvent: vi.fn(async () => {}),
}));
vi.mock("@/lib/scan-alerts", () => ({
  maybeAlertLowCredits: vi.fn(async () => {}),
  checkAndAlertRegression: vi.fn(async () => ({ regressed: false, verdict: null, dispatched: false })),
}));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  reportHandledError: vi.fn(),
}));

import { latestPublicReport, salvageScanFailure } from "@/lib/scan-lifecycle";
import { getScanReportByCommit } from "@/lib/db";
import { reportHandledError } from "@/lib/api/respond";

const mockLatest = vi.mocked(getScanReportByCommit);
const mockReport = vi.mocked(reportHandledError);

const PARSED = { owner: "o", repo: "r" };
const DOOR = "scan: latestPublicReport (getScanReportByCommit)";
const publicReport = { repo: { owner: "o", name: "r", headSha: "sha", isPrivate: false } } as unknown as ScanReport;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockLatest.mockReset().mockResolvedValue(null);
  mockReport.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe("latestPublicReport — door on the salvage read (scan-lifecycle.ts getScanReportByCommit catch)", () => {
  it("a thrown read resolves null (no salvage) and reaches the door with the read name", async () => {
    const boom = new Error("db blip");
    mockLatest.mockRejectedValueOnce(boom);

    await expect(latestPublicReport(PARSED, undefined)).resolves.toBeNull();

    expect(mockLatest).toHaveBeenCalledWith("o", "r", {});
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport).toHaveBeenCalledWith(boom, { message: expect.stringContaining(DOOR) });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(DOOR), boom);
  });

  it("a healthy read still serves the public report and keeps the door shut", async () => {
    mockLatest.mockResolvedValueOnce(publicReport);

    await expect(latestPublicReport(PARSED, undefined)).resolves.toBe(publicReport);
    expect(mockReport).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("a token scan never reads the shared store — so it can never open the door either", async () => {
    await expect(latestPublicReport(PARSED, "ghs_token")).resolves.toBeNull();
    expect(mockLatest).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });
});

describe("salvageScanFailure — a failed salvage read degrades to the hard error, through the door", () => {
  it("returns null (no salvage) when the latest-report read throws, and the door fires", async () => {
    const boom = new Error("pool exhausted");
    mockLatest.mockRejectedValueOnce(boom);

    const out = await salvageScanFailure(new Error("upstream 502"), {
      coordinate: { ghParsed: PARSED } as never,
      token: undefined,
      scoped: false,
    });

    expect(out).toBeNull();
    expect(mockReport).toHaveBeenCalledWith(boom, { message: expect.stringContaining(DOOR) });
  });
});
