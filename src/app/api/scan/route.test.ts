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
// isDbConfigured is a vi.fn() so the credit/refund describe below can flip it true (DB on) while
// the original cache-poisoning describe keeps it false. consumeScanCredit/grantCredits/getScanReportByCommit
// are spies the metered-path tests assert against.
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => false),
  persistScanReport: vi.fn(),
  consumeScanCredit: vi.fn(),
  grantCredits: vi.fn(),
  getScanReportByCommit: vi.fn(),
}));

// Entitlement gate: isMeteredScan decides whether the credit block runs; checkScanEntitlement is the
// 402 gate; paymentRequired builds the 402 body. Mocked so the metered branch is fully controllable
// without a DB. Defaults make scans NON-metered so the cache-poisoning describe is unaffected.
vi.mock("@/lib/entitlement", () => ({
  isMeteredScan: vi.fn(() => false),
  checkScanEntitlement: vi.fn(),
  paymentRequired: (balance: number) =>
    new Response(JSON.stringify({ code: "INSUFFICIENT_CREDITS", balance }), { status: 402 }),
}));

// Quota + supporting modules — neutral defaults so the existing tests behave exactly as before
// (quota fails open / not enforced; rate limit ok; no login wall).
vi.mock("@/lib/public-scan-quota", () => ({
  consumePublicScanQuota: vi.fn(async () => ({ enforced: false, allowed: true, remaining: 3, chargedAt: null, resetAt: null, signedIn: false })),
  refundPublicScanQuota: vi.fn(async () => {}),
  weeklyQuotaExceeded: () => new Response(JSON.stringify({ code: "weekly_quota" }), { status: 429 }),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => ({ ok: true })),
  tooManyRequests: () => new Response(null, { status: 429 }),
  SCAN_RATE_LIMIT: {},
}));
vi.mock("@/lib/scan-alerts", () => ({ maybeAlertLowCredits: vi.fn(async () => {}) }));
vi.mock("@/lib/access", () => ({ authGateEnabled: vi.fn(() => false), getViewer: vi.fn(async () => null) }));

import { POST } from "./route";
import { scanRepository, resolveScanAuth } from "@/lib/scan";
import { lookupCachedScan } from "@/lib/scan-cache";
import { cacheSet } from "@/lib/cache";
import { isDbConfigured, persistScanReport, consumeScanCredit, grantCredits } from "@/lib/db";
import { isMeteredScan, checkScanEntitlement } from "@/lib/entitlement";
import { consumePublicScanQuota, refundPublicScanQuota } from "@/lib/public-scan-quota";
import { rateLimitRequest } from "@/lib/rate-limit";
import { authGateEnabled, getViewer } from "@/lib/access";

const mockScan = vi.mocked(scanRepository);
const mockAuth = vi.mocked(resolveScanAuth);
const mockLookup = vi.mocked(lookupCachedScan);
const mockCacheSet = vi.mocked(cacheSet);
const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockPersist = vi.mocked(persistScanReport);
const mockConsumeCredit = vi.mocked(consumeScanCredit);
const mockGrantCredits = vi.mocked(grantCredits);
const mockIsMetered = vi.mocked(isMeteredScan);
const mockCheckEntitlement = vi.mocked(checkScanEntitlement);
const mockConsumeQuota = vi.mocked(consumePublicScanQuota);
const mockRefundQuota = vi.mocked(refundPublicScanQuota);

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

// clearAllMocks() wipes vi.fn() implementations, so every describe must re-install the neutral
// defaults its untested branches rely on (rate limit ok, quota fails open, not metered, DB off).
function installNeutralDefaults() {
  mockIsDbConfigured.mockReturnValue(false);
  mockIsMetered.mockReturnValue(false);
  mockRateLimitOk();
  mockConsumeQuota.mockResolvedValue({ enforced: false, allowed: true, remaining: 3, chargedAt: null, resetAt: null, signedIn: false } as never);
  mockRefundQuota.mockResolvedValue(undefined as never);
}
function mockRateLimitOk() {
  // rate-limit + access live in separate mocked modules; reset their impls too.
  vi.mocked(rateLimitRequest).mockReturnValue({ ok: true } as never);
  vi.mocked(authGateEnabled).mockReturnValue(false);
  vi.mocked(getViewer).mockResolvedValue(null);
}

describe("POST /api/scan — mock cache poisoning guard (#2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installNeutralDefaults();
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

// ---------------------------------------------------------------------------------------------------
// Credit reserve / 402 / refund-on-no-billable-product flow (credits-entitlements #1,
// scan-pipeline-ingestion #1). Pins the money-safety invariants of the route's metered branch:
//   - zero balance → 402, scan NOT run, nothing charged
//   - a real, newly-scored metered scan → reserve charged ONCE, NOT refunded
//   - degrade-to-mock / dedup / scan-throws → the reserved credit is refunded exactly once
//
// Metered path setup: resolveScanAuth returns a NON-public orgSlug AND a token. The token short-circuits
// the anonymous cache/lookup (route line 59 `!token`) so the scan goes straight to scanRepository, and
// isMeteredScan(true) + isDbConfigured(true) make the credit reserve/refund + persist blocks execute.
// A grantCredits(...,{reason:"refund"}) call is the route's ONLY refund mechanism (line 163), so its
// call count IS the "was the user refunded?" signal.
const meteredReport = (provider: string, confidence = 0.9) =>
  ({ engine: { provider, model: "m" }, warnings: [], confidence }) as unknown as ScanReport;

describe("POST /api/scan — credit reserve / 402 / refund flow (money-path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installNeutralDefaults();
    // Metered tenant: non-public orgSlug + a resolved installation token.
    mockAuth.mockResolvedValue({ orgSlug: "acme", token: "ghs_tok" });
    mockIsMetered.mockReturnValue(true);
    mockIsDbConfigured.mockReturnValue(true);
    // Default happy entitlement: a positive balance, not unlimited.
    mockCheckEntitlement.mockResolvedValue({ allowed: true, unlimited: false, balance: 5 });
    // Default reserve: atomic decrement succeeds (one credit reserved + charged), balance now 4.
    mockConsumeCredit.mockResolvedValue({ ok: true, unlimited: false, balance: 4, charged: true } as never);
    // Default grant (the refund) echoes a post-refund balance.
    mockGrantCredits.mockResolvedValue(5 as never);
    // Default persist: a NEW row (not a dedup).
    mockPersist.mockResolvedValue({ deduped: false, scanId: "scan_1", failures: { audit: false, contributors: 0 } } as never);
  });

  it("returns 402 and does NOT run the scan or charge when the org is out of credits", async () => {
    mockCheckEntitlement.mockResolvedValue({ allowed: false, unlimited: false, balance: 0 });
    const res = await post({ url: "o/r", mock: false });
    expect(res.status).toBe(402);
    expect(mockConsumeCredit).not.toHaveBeenCalled(); // never reserved
    expect(mockScan).not.toHaveBeenCalled(); // paid inference never runs
    expect(mockGrantCredits).not.toHaveBeenCalled(); // nothing to refund (nothing charged)
  });

  it("returns 402 when the reserve (atomic decrement) loses the race / fails", async () => {
    // checkScanEntitlement is a point-in-time read both racers pass; the loser's consumeScanCredit
    // returns ok:false → the reservation is the real gate. Assert it still paywalls.
    mockConsumeCredit.mockResolvedValue({ ok: false, unlimited: false, balance: 0 } as never);
    const res = await post({ url: "o/r", mock: false });
    expect(res.status).toBe(402);
    expect(mockScan).not.toHaveBeenCalled(); // reserve failed → no inference
    expect(mockGrantCredits).not.toHaveBeenCalled(); // nothing was reserved → no refund
  });

  it("charges the reserve exactly once and does NOT refund a real, newly-scored scan", async () => {
    mockScan.mockResolvedValue(meteredReport("gemini")); // real LLM, high confidence
    const res = await post({ url: "o/r", mock: false });
    expect(res.status).toBe(200);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1); // reserved once
    expect(mockGrantCredits).not.toHaveBeenCalled(); // NOT refunded — the user pays for the product
    // Post-debit balance surfaced to the client.
    expect(res.headers.get("x-ascent-credits-remaining")).toBe("4");
  });

  it("refunds the reserved credit when the scan degrades to mock (no billable product)", async () => {
    mockScan.mockResolvedValue(meteredReport("mock")); // LLM degraded to deterministic floor
    const res = await post({ url: "o/r", mock: false });
    expect(res.status).toBe(200);
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
    expect(mockGrantCredits).toHaveBeenCalledTimes(1); // refunded exactly once
    expect(mockGrantCredits).toHaveBeenCalledWith("acme", 1, expect.objectContaining({ reason: "refund" }));
    // Header reflects the post-refund balance (grant returned 5).
    expect(res.headers.get("x-ascent-credits-remaining")).toBe("5");
  });

  it("refunds the reserved credit on a dedup (already-scored commit) — a dedup run is free", async () => {
    mockScan.mockResolvedValue(meteredReport("gemini")); // real engine, but...
    mockPersist.mockResolvedValue({ deduped: true, scanId: "scan_1", failures: { audit: false, contributors: 0 } } as never);
    const res = await post({ url: "o/r", mock: false });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ascent-dedup")).toBe("hit");
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
    expect(mockGrantCredits).toHaveBeenCalledTimes(1); // exactly one refund
  });

  it("low coverage only skips caching — a real, newly-scored low-coverage scan KEEPS its charge", async () => {
    // Route behavior (route.ts:210-211): lowCoverage (confidence<0.5) only SKIPS the cacheSet; it does
    // NOT trigger refundCredit (unlike degrade-to-mock/dedup/throw). A real gemini engine that persists a
    // new non-dedup row therefore stays charged. Pinning this prevents a future "refund low coverage too"
    // regression from silently changing the billing contract without a test catching it.
    mockScan.mockResolvedValue(meteredReport("gemini", 0.3)); // real engine, confidence < 0.5
    const res = await post({ url: "o/r", mock: false });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ascent-cache")).toBe("miss"); // not cached
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
    expect(mockGrantCredits).not.toHaveBeenCalled(); // low coverage alone is NOT refunded
  });

  it("refunds the reserved credit exactly once when scanRepository throws (typo / 404 / abort)", async () => {
    mockScan.mockRejectedValue(new Error("boom")); // ingest failed → no product delivered
    const res = await post({ url: "o/r", mock: false });
    expect(res.status).toBe(500); // unexpected error mapped by handleError
    expect(mockConsumeCredit).toHaveBeenCalledTimes(1);
    // The catch refunds; creditReserved flips false so a later refund can't double-fire.
    expect(mockGrantCredits).toHaveBeenCalledTimes(1);
    expect(mockGrantCredits).toHaveBeenCalledWith("acme", 1, expect.objectContaining({ reason: "refund" }));
  });

  it("does NOT reserve a credit for an unlimited-plan org (no debit, no refund)", async () => {
    mockCheckEntitlement.mockResolvedValue({ allowed: true, unlimited: true, balance: 0 });
    mockScan.mockResolvedValue(meteredReport("gemini"));
    const res = await post({ url: "o/r", mock: false });
    expect(res.status).toBe(200);
    expect(mockConsumeCredit).not.toHaveBeenCalled(); // unlimited → never debited
    expect(mockGrantCredits).not.toHaveBeenCalled(); // nothing reserved → nothing to refund
  });
});

// ---------------------------------------------------------------------------------------------------
// Public (anonymous) quota refund ledger (scan-pipeline-ingestion #1, quota half). The anonymous
// public funnel meters a free WEEKLY slot (not credits). A consumed slot is refunded on the same
// no-billable-product branches (degrade-to-mock / throw). Driven via the public path: no token,
// orgSlug "public", a consume that reports an enforced charge with a chargedAt timestamp.
describe("POST /api/scan — public weekly-quota refund (money-path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installNeutralDefaults();
    mockAuth.mockResolvedValue({ orgSlug: "public" }); // anonymous, no token → quota-metered
    mockIsDbConfigured.mockReturnValue(true);
    mockPersist.mockResolvedValue({ deduped: false, scanId: "s", failures: { audit: false, contributors: 0 } } as never);
    mockLookup.mockResolvedValue(lookup("o/r@sha::llm"));
    // A slot WAS consumed (enforced + allowed), charged at a known timestamp the refund must echo.
    mockConsumeQuota.mockResolvedValue({ enforced: true, allowed: true, remaining: 2, chargedAt: 1000, resetAt: 2000, signedIn: false } as never);
  });

  it("does NOT refund the weekly slot for a real, newly-scored public scan", async () => {
    mockScan.mockResolvedValue(meteredReport("gemini"));
    const res = await post({ url: "o/r", mock: false });
    expect(res.status).toBe(200);
    expect(mockConsumeQuota).toHaveBeenCalledTimes(1);
    expect(mockRefundQuota).not.toHaveBeenCalled(); // a delivered product keeps its slot
  });

  it("refunds the weekly slot when a public scan degrades to mock", async () => {
    mockScan.mockResolvedValue(meteredReport("mock"));
    const res = await post({ url: "o/r", mock: false });
    expect(res.status).toBe(200);
    expect(mockRefundQuota).toHaveBeenCalledTimes(1);
    // Refund must thread the EXACT chargedAt so it peels off this request's own slot, not a sibling's.
    expect(mockRefundQuota).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1000);
  });

  it("refunds the weekly slot when a public scan throws", async () => {
    mockScan.mockRejectedValue(new Error("boom"));
    const res = await post({ url: "o/r", mock: false });
    expect(res.status).toBe(500);
    expect(mockRefundQuota).toHaveBeenCalledTimes(1);
    expect(mockRefundQuota).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1000);
  });
});
