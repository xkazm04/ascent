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
vi.mock("@/lib/cache", () => ({
  cacheSet: vi.fn(),
  // Passthrough: run the scan factory directly so these tests exercise the real cache-write path.
  coalesceScan: (_key: string, factory: (s: AbortSignal) => Promise<unknown>) =>
    factory(new AbortController().signal),
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => false),
  persistScanReport: vi.fn(async () => ({ deduped: false })),
  getScanReportByCommit: vi.fn(async () => null),
  getOrgId: vi.fn(async () => null),
  recordQuotaEvent: vi.fn(async () => {}),
}));
// The credit gate's two collaborators. `@/lib/scan-credit` is the mechanism scanCreditGate layers on
// (reserve → refund); stubbing it here lets these tests assert the ROUTE's money decisions — did it
// reserve, did it hand the credit back — without a database.
vi.mock("@/lib/entitlement", () => ({
  isMeteredScan: vi.fn(() => false),
  checkScanEntitlement: vi.fn(async () => ({ allowed: true, unlimited: false, balance: 5 })),
  paymentRequired: (balance: number) =>
    new Response(JSON.stringify({ code: "INSUFFICIENT_CREDITS", balance }), { status: 402 }),
}));
vi.mock("@/lib/scan-credit", () => ({
  reserveScanCredit: vi.fn(async () => ({ skip: false, reserved: true, balance: 4 })),
  refundScanCredit: vi.fn(async () => 5),
}));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, getViewer: vi.fn(async () => null) }));

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

// ── CREDIT METERING ──────────────────────────────────────────────────────────────────────────────
//
// This route runs real LLM inference against PRIVATE org repositories and, until the shared
// `scanCreditGate` landed, imported no credit code at all: no entitlement check, no reservation, no
// refund. Its own comment asserted the opposite ("private (token) scans are credit-metered and skip
// [the monthly quota]"), so the most expensive path in the product was billed by neither meter. These
// tests pin the four decisions that fix has to keep making.

import { isMeteredScan, checkScanEntitlement } from "@/lib/entitlement";
import { reserveScanCredit, refundScanCredit } from "@/lib/scan-credit";
import { isDbConfigured, persistScanReport } from "@/lib/db";

const mockMetered = vi.mocked(isMeteredScan);
const mockEnt = vi.mocked(checkScanEntitlement);
const mockReserve = vi.mocked(reserveScanCredit);
const mockRefund = vi.mocked(refundScanCredit);
const mockDbConfigured = vi.mocked(isDbConfigured);
const mockPersist = vi.mocked(persistScanReport);

/** POST and return the response WITHOUT draining, for the pre-stream rejections (402). */
const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/scan/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/scan/stream — credit metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A private / installed-org scan: an installation token was minted, so this is the metered shape.
    mockAuth.mockResolvedValue({ orgSlug: "acme", token: "ghs_x" } as Awaited<ReturnType<typeof resolveScanAuth>>);
    mockMetered.mockReturnValue(true);
    mockEnt.mockResolvedValue({
      allowed: true,
      unlimited: false,
      balance: 5,
      withinAllowance: false,
      allowanceRemaining: 0,
    } as Awaited<ReturnType<typeof checkScanEntitlement>>);
    mockReserve.mockResolvedValue({ skip: false, reserved: true, balance: 4 });
    mockRefund.mockResolvedValue(5);
    mockDbConfigured.mockReturnValue(false);
    mockScan.mockResolvedValue(reportWith("gemini"));
  });

  it("answers 402 — before the stream opens — when the org is out of credits", async () => {
    mockEnt.mockResolvedValue({
      allowed: false,
      unlimited: false,
      balance: 0,
      withinAllowance: false,
      allowanceRemaining: 0,
    } as Awaited<ReturnType<typeof checkScanEntitlement>>);

    const res = await post({ url: "o/r" });

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "INSUFFICIENT_CREDITS", balance: 0 });
    // Nothing was reserved and, decisively, no inference ran.
    expect(mockReserve).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("answers 402 when the reservation loses the race for the last credit", async () => {
    // checkScanEntitlement is a point-in-time READ two concurrent scans both pass; the atomic
    // conditional decrement inside reserveScanCredit is the real gate, and its refusal must 402 too.
    mockReserve.mockResolvedValue({ skip: true, reserved: false, balance: 0 });

    const res = await post({ url: "o/r" });

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ balance: 0 });
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("reserves BEFORE inference and reports the post-reservation balance", async () => {
    const res = await POST(
      new Request("http://localhost/api/scan/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "o/r" }),
      }),
    );

    // The header is set when the stream opens — i.e. after the reservation, before any refund.
    expect(res.headers.get("x-ascent-credits-remaining")).toBe("4");
    expect(mockReserve).toHaveBeenCalledWith("acme", "o/r");
    await res.text();
    // A real, newly-scored metered scan KEEPS its charge.
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("refunds the reservation when the scan degrades to mock", async () => {
    mockScan.mockResolvedValue(reportWith("mock"));

    await postAndDrain({ url: "o/r", mock: false });

    expect(mockRefund).toHaveBeenCalledWith("acme", true);
  });

  it("refunds the reservation when the commit was already scored (dedup)", async () => {
    mockDbConfigured.mockReturnValue(true);
    mockPersist.mockResolvedValue({ deduped: true } as Awaited<ReturnType<typeof persistScanReport>>);

    await postAndDrain({ url: "o/r", mock: false });

    expect(mockRefund).toHaveBeenCalledWith("acme", true);
  });

  it("refunds the reservation when the scan throws (upstream failure / client abort)", async () => {
    mockScan.mockRejectedValue(new Error("github exploded"));

    await postAndDrain({ url: "o/r", mock: false });

    expect(mockRefund).toHaveBeenCalledWith("acme", true);
  });

  it("never charges a PUBLIC (token-less) scan", async () => {
    mockAuth.mockResolvedValue({ orgSlug: "public" } as Awaited<ReturnType<typeof resolveScanAuth>>);
    mockMetered.mockReturnValue(false);
    mockLookup.mockResolvedValue(lookup("o/r@sha::llm"));

    const res = await POST(
      new Request("http://localhost/api/scan/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "o/r" }),
      }),
    );
    await res.text();

    expect(mockEnt).not.toHaveBeenCalled();
    expect(mockReserve).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
    // …and no credit header is invented for a scan that never had a balance to report.
    expect(res.headers.get("x-ascent-credits-remaining")).toBeNull();
  });
});
