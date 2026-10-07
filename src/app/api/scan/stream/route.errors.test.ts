// The two terminal failure paths of the SSE scan route each emit an `event: error` frame AND hand the
// defect to reportHandledError (the 200 and headers are long gone, so onRequestError can't see it):
// deliverFailure (the scan itself threw) and the post-scan catch (a stage AFTER the scan threw).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";
import type { ScanCacheLookup } from "@/lib/scan-cache";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(), resolveScanAuth: vi.fn() }));
vi.mock("@/lib/scan-cache", () => ({ lookupCachedScan: vi.fn() }));
vi.mock("@/lib/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cache")>();
  return {
    cacheSet: vi.fn(),
    cacheDelete: actual.cacheDelete,
    inflightScanCount: actual.inflightScanCount,
    coalesceScan: (...args: Parameters<typeof actual.coalesceScan>) =>
      args[1](new AbortController().signal, () => {}),
  };
});
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  persistScanReport: vi.fn(async () => ({ deduped: false })),
  getScanReportByCommit: vi.fn(async () => null),
  getOrgId: vi.fn(async () => null),
  recordQuotaEvent: vi.fn(async () => {}),
}));
vi.mock("@/lib/entitlement", () => ({
  isMeteredScan: vi.fn(() => false),
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: false, balance: 5 })),
}));
vi.mock("@/lib/scan-credit", () => ({
  reserveScanCredit: vi.fn(async () => ({ skip: false, reserved: true, balance: 4 })),
  refundScanCredit: vi.fn(async () => 5),
}));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  reportHandledError: vi.fn(),
}));
vi.mock("@/lib/scan-finalize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scan-finalize")>();
  return {
    ...actual,
    cacheAndPersistScan: async (...args: Parameters<typeof actual.cacheAndPersistScan>) => {
      if (finalize.fail) throw finalize.fail;
      return actual.cacheAndPersistScan(...args);
    },
    consumeScanQuota: async () => ({
      blocked: null, quotaRemaining: 4, quotaResetAt: null, quotaScope: "anon" as const, refund: async () => {},
    }),
  };
});

import { POST } from "./route";
import { scanRepository, resolveScanAuth } from "@/lib/scan";
import { lookupCachedScan } from "@/lib/scan-cache";
import { reportHandledError } from "@/lib/api/respond";

const finalize = vi.hoisted(() => ({ fail: null as null | Error }));
const lookup: ScanCacheLookup = { cacheKey: "o/r@sha::llm", headSha: "sha", etag: "e", cached: null, source: null };
const report = {
  engine: { provider: "gemini", model: "m" },
  warnings: [],
  confidence: 0.9,
  repo: { owner: "o", name: "r", headSha: "sha" },
} as unknown as ScanReport;

async function drain(): Promise<string> {
  const res = await POST(
    new Request("http://localhost/api/scan/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "o/r" }),
    }),
  );
  return res.text();
}

beforeEach(() => {
  vi.clearAllMocks();
  finalize.fail = null;
  vi.mocked(resolveScanAuth).mockResolvedValue({ orgSlug: "public" });
  vi.mocked(lookupCachedScan).mockResolvedValue(lookup);
});

describe("POST /api/scan/stream — terminal failures are framed AND reported", () => {
  it("deliverFailure: a scan that throws emits event: error and reports the defect", async () => {
    const boom = new Error("pipeline blew up");
    vi.mocked(scanRepository).mockRejectedValue(boom);
    const text = await drain();
    expect(text).toContain("event: error");
    expect(text).toContain("Unexpected error while scanning the repository.");
    expect(reportHandledError).toHaveBeenCalledWith(boom, expect.objectContaining({ message: expect.any(String) }));
  });

  it("post-scan catch: a stage after the scan that throws emits event: error and reports it", async () => {
    const boom = new Error("persist exploded");
    vi.mocked(scanRepository).mockResolvedValue(report);
    finalize.fail = boom;
    const text = await drain();
    expect(text).toContain("event: error");
    expect(reportHandledError).toHaveBeenCalledWith(boom, expect.objectContaining({ message: expect.any(String) }));
  });
});
