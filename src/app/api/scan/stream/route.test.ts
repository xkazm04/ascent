// Integration test for the SSE scan route's mock-cache-poisoning guard (scan-and-decide idea
// efc80ce5). The stream route carries its own copy of the degradedToMock guard, so it gets its
// own test to keep the two route copies from drifting. The stream is drained via response.text()
// so the ReadableStream's start() runs to completion before we assert on cacheSet.

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
vi.mock("@/lib/cache", () => ({ cacheSet: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => false, persistScanReport: vi.fn() }));

import { POST } from "./route";
import { scanRepository, resolveScanAuth } from "@/lib/scan";
import { lookupCachedScan } from "@/lib/scan-cache";
import { cacheSet } from "@/lib/cache";

const mockScan = vi.mocked(scanRepository);
const mockAuth = vi.mocked(resolveScanAuth);
const mockLookup = vi.mocked(lookupCachedScan);
const mockCacheSet = vi.mocked(cacheSet);

async function postAndDrain(body: unknown) {
  const res = await POST(
    new Request("http://localhost/api/scan/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  await res.text(); // drain the SSE stream so start() runs to completion
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

describe("POST /api/scan/stream — mock cache poisoning guard (#2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ orgSlug: "public" });
  });

  it("does NOT cache a degraded mock report under the llm key", async () => {
    mockLookup.mockResolvedValue(lookup("o/r@sha::llm"));
    mockScan.mockResolvedValue(reportWith("mock"));
    await postAndDrain({ url: "o/r", mock: false });
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it("caches a real LLM report under the llm key", async () => {
    mockLookup.mockResolvedValue(lookup("o/r@sha::llm"));
    mockScan.mockResolvedValue(reportWith("gemini"));
    await postAndDrain({ url: "o/r", mock: false });
    expect(mockCacheSet).toHaveBeenCalledWith("o/r@sha::llm", expect.anything());
  });
});
