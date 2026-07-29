// G8-49 — the two single-repo scan entry points must answer a pre-scan gate rejection IDENTICALLY.
//
// /api/scan (sync JSON) and /api/scan/stream (SSE) used to order their gates differently: the stream
// ran rate limit → sign-in wall, the JSON route ran sign-in wall → rate limit. One throttled anonymous
// request therefore got 401 from one endpoint and 429 from the other, and only the stream recorded the
// `rate_limit` quota event, so throttled JSON traffic never showed up in observability.
//
// Both now run rate limit → sign-in wall → quota. These tests pin the observable contract of that
// decision — the status AND the quota event — for both routes from a single table, so the pair cannot
// drift apart again. They also pin the property the JSON route's old ordering existed to protect: its
// limiter still sits AFTER the free cache-hit return, so hydrating a saved report is unthrottled.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";
import type { ScanCacheLookup } from "@/lib/scan-cache";

vi.mock("next/server", () => ({
  // Extends Response so the JSON route's `new NextResponse(null, { status: 204 })` carries a real
  // status; the stream route only uses NextResponse.json before the stream opens.
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn(), resolveScanAuth: vi.fn() }));
vi.mock("@/lib/scan-cache", () => ({
  lookupCachedScan: vi.fn(),
  lookupScopedScan: vi.fn(),
  resolveHeadWithHint: vi.fn(),
  isPersistedScanFresh: vi.fn(() => false),
}));
vi.mock("@/lib/cache", () => ({
  cacheSet: vi.fn(),
  coalesceScan: (_key: string, factory: (s: AbortSignal) => Promise<unknown>) => factory(new AbortController().signal),
}));
vi.mock("@/lib/db", () => ({
  CREDIT_REASON: { SCAN: "scan", REFUND: "refund" },
  isDbConfigured: vi.fn(() => false),
  persistScanReport: vi.fn(),
  consumeScanCredit: vi.fn(),
  grantCredits: vi.fn(),
  getScanReportByCommit: vi.fn(async () => null),
  getOrgId: vi.fn(async () => null),
  // The observability side effect the divergence used to lose on one of the two routes.
  recordQuotaEvent: vi.fn(async () => {}),
}));
vi.mock("@/lib/entitlement", () => ({
  isMeteredScan: vi.fn(() => false),
  checkScanEntitlement: vi.fn(),
  paymentRequired: (balance: number) => new Response(JSON.stringify({ balance }), { status: 402 }),
}));
vi.mock("@/lib/public-scan-quota", () => ({
  consumePublicScanQuota: vi.fn(async () => ({
    enforced: false,
    allowed: true,
    remaining: 3,
    chargedAt: null,
    resetAt: null,
    signedIn: false,
  })),
  refundPublicScanQuota: vi.fn(async () => {}),
  monthlyQuotaExceeded: () => new Response(JSON.stringify({ code: "monthly_quota" }), { status: 429 }),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitRequest: vi.fn(() => ({ ok: true })),
  rateLimitRequestShared: vi.fn(async () => ({ ok: true })),
  // Mirrors the real helper's shape closely enough to assert on: status + Retry-After.
  tooManyRequests: (retryAfterSec: number) =>
    new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "retry-after": String(retryAfterSec) },
    }),
  SCAN_RATE_LIMIT: {},
  PEEK_RATE_LIMIT: {},
}));
vi.mock("@/lib/scan-alerts", () => ({
  maybeAlertLowCredits: vi.fn(async () => {}),
  checkAndAlertRegression: vi.fn(async () => ({ regressed: false, verdict: null, dispatched: false })),
}));
vi.mock("@/lib/access", () => ({ authGateEnabled: vi.fn(() => false), getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/email", () => ({
  dispatchScanCompletionEmail: vi.fn(async () => ({ ok: true, skipped: false })),
  emailSendingEnabled: () => false,
  isValidEmail: () => false,
}));

import { POST as scanPost } from "./route";
import { POST as streamPost } from "./stream/route";
import { resolveScanAuth } from "@/lib/scan";
import { lookupCachedScan } from "@/lib/scan-cache";
import { rateLimitRequestShared } from "@/lib/rate-limit";
import { authGateEnabled, getViewer } from "@/lib/access";
import { recordQuotaEvent } from "@/lib/db";
import { consumePublicScanQuota } from "@/lib/public-scan-quota";

const mockAuth = vi.mocked(resolveScanAuth);
const mockLookup = vi.mocked(lookupCachedScan);
const mockShared = vi.mocked(rateLimitRequestShared);
const mockAuthGateEnabled = vi.mocked(authGateEnabled);
const mockGetViewer = vi.mocked(getViewer);
const mockRecordQuotaEvent = vi.mocked(recordQuotaEvent);
const mockConsumeQuota = vi.mocked(consumePublicScanQuota);

const lookup = (cached: ScanReport | null = null): ScanCacheLookup => ({
  cacheKey: "o/r@sha::llm",
  headSha: "sha",
  etag: "e",
  cached,
  source: cached ? "memory" : null,
});

/** The SAME anonymous public-scan request, sent to each route. */
const ROUTES = [
  {
    name: "/api/scan",
    post: () =>
      scanPost(
        new Request("http://localhost/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: "https://github.com/o/r" }),
        }),
      ),
  },
  {
    name: "/api/scan/stream",
    post: () =>
      streamPost(
        new Request("http://localhost/api/scan/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: "https://github.com/o/r" }),
        }),
      ),
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ orgSlug: "public" } as Awaited<ReturnType<typeof resolveScanAuth>>);
  mockLookup.mockResolvedValue(lookup());
  mockShared.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof rateLimitRequestShared>>);
  mockAuthGateEnabled.mockReturnValue(false);
  mockGetViewer.mockResolvedValue(null);
  mockConsumeQuota.mockResolvedValue({
    enforced: false,
    allowed: true,
    remaining: 3,
    chargedAt: null,
    resetAt: null,
    signedIn: false,
  } as Awaited<ReturnType<typeof consumePublicScanQuota>>);
});

describe("G8-49 — /api/scan and /api/scan/stream answer the pre-scan gates identically", () => {
  describe.each(ROUTES)("$name", ({ post }) => {
    it("answers a THROTTLED anonymous caller with 429 (not 401), even with the sign-in wall on", async () => {
      // Both gates would reject. Rate limit wins on both routes: it is the truthful answer (the shared
      // budget is exhausted regardless of who is asking) and signing in would not lift it.
      mockShared.mockResolvedValue({ ok: false, retryAfterSec: 7 } as Awaited<
        ReturnType<typeof rateLimitRequestShared>
      >);
      mockAuthGateEnabled.mockReturnValue(true);
      mockGetViewer.mockResolvedValue(null);

      const res = await post();

      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("7");
    });

    it("records the `rate_limit` quota event when it throttles — on BOTH routes", async () => {
      mockShared.mockResolvedValue({ ok: false, retryAfterSec: 7 } as Awaited<
        ReturnType<typeof rateLimitRequestShared>
      >);
      mockAuthGateEnabled.mockReturnValue(true);

      await post();

      expect(mockRecordQuotaEvent).toHaveBeenCalledWith("rate_limit", "scan");
    });

    it("never consumes a monthly free slot for a throttled request (limiter stays before the quota)", async () => {
      mockShared.mockResolvedValue({ ok: false, retryAfterSec: 7 } as Awaited<
        ReturnType<typeof rateLimitRequestShared>
      >);

      await post();

      expect(mockConsumeQuota).not.toHaveBeenCalled();
    });

    it("answers an UNTHROTTLED anonymous caller with 401 when the sign-in wall is on", async () => {
      mockShared.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof rateLimitRequestShared>>);
      mockAuthGateEnabled.mockReturnValue(true);
      mockGetViewer.mockResolvedValue(null);

      const res = await post();

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "auth_required" });
    });
  });

  it("the JSON route's limiter still sits AFTER the free cache-hit return — hydration is unthrottled", async () => {
    // The property the old (auth-first) ordering existed to protect, and the reason the limiter was
    // NOT hoisted to the top of the handler when the order was unified: a saved report must cost
    // nothing, even while the burst budget is exhausted.
    mockShared.mockResolvedValue({ ok: false, retryAfterSec: 7 } as Awaited<
      ReturnType<typeof rateLimitRequestShared>
    >);
    mockLookup.mockResolvedValue(lookup({ repo: { owner: "o", name: "r" } } as unknown as ScanReport));

    const res = await ROUTES[0].post();

    expect(res.status).toBe(200);
    expect(res.headers.get("x-ascent-cache")).toBe("hit");
    expect(mockShared).not.toHaveBeenCalled();
  });
});
