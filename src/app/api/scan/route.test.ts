// Integration test for the JSON scan route's mock-cache-poisoning guard (scan-and-decide idea
// efc80ce5): when an LLM scan degrades to MockProvider, the route must NOT cache that mock report
// under the `::llm` key (which would serve the mock floor to every later scanner of the commit).
// The scan/lookup/cache/db boundaries are mocked so we can assert exactly when cacheSet fires.

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
vi.mock("@/lib/cache", () => ({
  cacheSet: vi.fn(),
  // Passthrough: run the scan factory directly so these tests exercise the real cache-write path.
  coalesceScan: (_key: string, factory: (s: AbortSignal) => Promise<unknown>) =>
    factory(new AbortController().signal),
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => false, persistScanReport: vi.fn() }));

import { POST } from "./route";
import { scanRepository, resolveScanAuth } from "@/lib/scan";
import { lookupCachedScan } from "@/lib/scan-cache";
import { cacheSet } from "@/lib/cache";

const mockScan = vi.mocked(scanRepository);
const mockAuth = vi.mocked(resolveScanAuth);
const mockLookup = vi.mocked(lookupCachedScan);
const mockCacheSet = vi.mocked(cacheSet);

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
const reportWith = (provider: string) =>
  ({ engine: { provider, model: "m" }, warnings: [] }) as unknown as ScanReport;
const lookup = (cacheKey: string): ScanCacheLookup => ({
  cacheKey,
  headSha: "sha",
  etag: "e",
  cached: null,
  source: null,
});

describe("POST /api/scan — mock cache poisoning guard (#2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ orgSlug: "public" }); // anonymous → eligible for the public cache
  });

  it("does NOT cache a degraded mock report under the llm key", async () => {
    mockLookup.mockResolvedValue(lookup("o/r@sha::llm"));
    mockScan.mockResolvedValue(reportWith("mock")); // LLM requested but it fell back to mock
    await post({ url: "o/r", mock: false });
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it("caches a real LLM report under the llm key", async () => {
    mockLookup.mockResolvedValue(lookup("o/r@sha::llm"));
    mockScan.mockResolvedValue(reportWith("gemini"));
    await post({ url: "o/r", mock: false });
    expect(mockCacheSet).toHaveBeenCalledWith("o/r@sha::llm", expect.anything());
  });

  it("caches an intentional mock scan under its mock key", async () => {
    mockLookup.mockResolvedValue(lookup("o/r@sha::mock"));
    mockScan.mockResolvedValue(reportWith("mock"));
    await post({ url: "o/r", mock: true });
    expect(mockCacheSet).toHaveBeenCalledWith("o/r@sha::mock", expect.anything());
  });
});
