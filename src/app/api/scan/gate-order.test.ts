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
// The scope resolver issues a real GitHub ref lookup; stubbed so the scoped-cache table below can
// state the resolved scope directly. Default: nothing scoped (every pre-existing test in this file).
vi.mock("@/lib/scan-scope-server", () => ({
  UNSCOPED: { error: null, scope: {}, pinSha: null, requested: false },
  resolveScanScope: vi.fn(async () => ({ error: null, scope: {}, pinSha: null, requested: false })),
}));
// The credit mechanism scanCreditGate layers on. Mocked so the refund table can COUNT credit
// movements without a database (the route's only credit lever is this pair).
vi.mock("@/lib/scan-credit", () => ({
  reserveScanCredit: vi.fn(async () => ({ skip: false, reserved: true, balance: 4 })),
  refundScanCredit: vi.fn(async () => 5),
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
  orgNotFound: () => new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }),
  scanCreditRefusal: (decision: { reason: "not_found" } | { reason: "payment_required"; balance: number }) =>
    decision.reason === "not_found"
      ? new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 })
      : new Response(JSON.stringify({ balance: decision.balance }), { status: 402 }),
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
  // Mirrors the real helper's shape closely enough to assert on: status + Retry-After. It accepts
  // EITHER a bare delay or the whole RateLimitResult, because the real helper does — the routes now
  // pass the result so a global refusal can name its scope, and a stub that only understood a number
  // stringified the object into the header instead of failing loudly.
  tooManyRequests: (arg: number | { retryAfterSec: number }) =>
    new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "retry-after": String(typeof arg === "number" ? arg : arg.retryAfterSec) },
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
import { resolveScanAuth, scanRepository } from "@/lib/scan";
import { lookupCachedScan, lookupScopedScan } from "@/lib/scan-cache";
import { rateLimitRequestShared } from "@/lib/rate-limit";
import { authGateEnabled, getViewer } from "@/lib/access";
import { getScanReportByCommit, isDbConfigured, persistScanReport, recordQuotaEvent } from "@/lib/db";
import { consumePublicScanQuota, refundPublicScanQuota } from "@/lib/public-scan-quota";
import { isMeteredScan, checkScanEntitlement } from "@/lib/entitlement";
import { refundScanCredit } from "@/lib/scan-credit";
import { resolveScanScope } from "@/lib/scan-scope-server";

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

    // UAT TOMAS-L1-01 — the advertised free, no-signup PUBLIC scan must not 401. Everything
    // read-only was already open; walling the one action a buyer needs was the blocker.
    it("lets an UNTHROTTLED anonymous caller run a PUBLIC scan even with the sign-in wall on", async () => {
      mockShared.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof rateLimitRequestShared>>);
      mockAuthGateEnabled.mockReturnValue(true);
      mockGetViewer.mockResolvedValue(null);

      // The request proceeds past the wall into the (mocked) scan, which may reject downstream —
      // irrelevant here. What matters is that it reached the monthly quota gate, which sits
      // immediately after the sign-in wall, instead of being turned away at it.
      await post().catch(() => {});

      expect(mockConsumeQuota).toHaveBeenCalled();
    });

    it("re-walls the public funnel when the operator opts in via ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN", async () => {
      vi.stubEnv("ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN", "1");
      mockShared.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof rateLimitRequestShared>>);
      mockAuthGateEnabled.mockReturnValue(true);
      mockGetViewer.mockResolvedValue(null);

      const res = await post();

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "auth_required" });
      expect(mockConsumeQuota).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it("still answers 401 for a PRIVATE / installed-org scan when the sign-in wall is on", async () => {
      // The exemption is scoped to the anonymous public funnel; a scan that resolved an installation
      // token is a gated feature and is walled exactly as before.
      mockAuth.mockResolvedValue({ orgSlug: "acme", token: "ghs_x" } as Awaited<ReturnType<typeof resolveScanAuth>>);
      mockShared.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof rateLimitRequestShared>>);
      mockAuthGateEnabled.mockReturnValue(true);
      mockGetViewer.mockResolvedValue(null);

      const res = await post();

      expect(res.status).toBe(401);
      expect(mockConsumeQuota).not.toHaveBeenCalled();
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

// ── ONE LIFECYCLE: the two entry points run the SAME post-gate sequence ──────────────────────────
//
// The gates above were single-sourced into scan-gates.ts; the SEQUENCE between them and the persist
// layer was not, so each route owned ~150 lines of identical ordering and the copies drifted. These
// tables assert the observable consequences of that sequence from ONE place, for both entry points:
// the forge coordinate, the invalid-URL placement, the failure salvage, the private re-tenant, the
// scoped-cache rule, and the refund ledger. The ledger's own table (six situations x two meters) is
// in src/lib/scan-lifecycle.test.ts; here it is proven to be the ledger BOTH routes reach.

const mockScanRepo = vi.mocked(scanRepository);
const mockScopedLookup = vi.mocked(lookupScopedScan);
const mockDbOn = vi.mocked(isDbConfigured);
const mockPersist = vi.mocked(persistScanReport);
const mockLatest = vi.mocked(getScanReportByCommit);
const mockQuotaRefund = vi.mocked(refundPublicScanQuota);
const mockMetered = vi.mocked(isMeteredScan);
const mockEntitlement = vi.mocked(checkScanEntitlement);
const mockCreditRefund = vi.mocked(refundScanCredit);
const mockScope = vi.mocked(resolveScanScope);

const reportOf = (over: Record<string, unknown> = {}) =>
  ({
    repo: { owner: "o", name: "r", headSha: "sha", isPrivate: false },
    engine: { provider: "gemini", model: "m" },
    warnings: [],
    confidence: 0.9,
    ...over,
  }) as unknown as ScanReport;

/** The same body, sent to each entry point; the SSE stream is drained so start() runs to completion. */
const ENTRY_POINTS = [
  {
    name: "/api/scan",
    send: async (body: unknown) => {
      const res = await scanPost(
        new Request("http://localhost/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      return { res, text: await res.text().catch(() => "") };
    },
  },
  {
    name: "/api/scan/stream",
    send: async (body: unknown) => {
      const res = await streamPost(
        new Request("http://localhost/api/scan/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      return { res, text: await res.text().catch(() => "") };
    },
  },
] as const;

function anonymousDefaults() {
  mockAuth.mockResolvedValue({ orgSlug: "public" } as Awaited<ReturnType<typeof resolveScanAuth>>);
  mockLookup.mockResolvedValue(lookup());
  mockShared.mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof rateLimitRequestShared>>);
  mockAuthGateEnabled.mockReturnValue(false);
  mockGetViewer.mockResolvedValue(null);
  mockMetered.mockReturnValue(false);
  mockDbOn.mockReturnValue(false);
  mockLatest.mockResolvedValue(null as never);
  mockScanRepo.mockResolvedValue(reportOf());
  mockScope.mockResolvedValue({ error: null, scope: {}, pinSha: null, requested: false } as never);
  mockConsumeQuota.mockResolvedValue({
    enforced: true,
    allowed: true,
    remaining: 2,
    chargedAt: 1000,
    resetAt: 2000,
    signedIn: false,
  } as Awaited<ReturnType<typeof consumePublicScanQuota>>);
}

describe.each(ENTRY_POINTS)("one scan lifecycle - $name", ({ name, send }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    anonymousDefaults();
  });

  // ACCEPTANCE 1 - the scan form emits `gitlab:group/project` (normalizeScanRepo.ts) and /report POSTs
  // it to the stream, which parsed GitHub coordinates only and answered 400 for every one of them.
  it("scans the GitLab coordinate the scan form emits", async () => {
    const { res } = await send({ url: "gitlab:group/project" });

    expect(res.status).toBe(200);
    expect(mockScanRepo).toHaveBeenCalledWith("gitlab:group/project", expect.anything());
    // A non-GitHub coordinate must never reach the ambient GitHub PAT.
    expect(mockScanRepo.mock.calls[0]?.[1]).toMatchObject({ noAmbientToken: true });
    // And it takes the token-less, cache-less path a GitHub-keyed lookup cannot serve.
    expect(mockLookup).not.toHaveBeenCalled();
  });

  // ACCEPTANCE 7 - regression pin on today's behaviour, both routes.
  it("answers 400 INVALID_URL before a monthly slot is consumed", async () => {
    const { res, text } = await send({ url: "not a repo at all!!" });

    expect(res.status).toBe(400);
    expect(text).toContain("INVALID_URL");
    expect(mockConsumeQuota).not.toHaveBeenCalled();
    expect(mockScanRepo).not.toHaveBeenCalled();
  });

  // ACCEPTANCE 3 - the any-commit salvage existed on the JSON route only, so a transient GitHub blip
  // five minutes into a LIVE scan handed the user an error where the other endpoint served last
  // week's report.
  it("salvages the latest persisted PUBLIC report when the scan throws", async () => {
    const salvaged = reportOf({ repo: { owner: "o", name: "r", headSha: "old", isPrivate: false } });
    mockLatest.mockResolvedValue(salvaged as never);
    mockScanRepo.mockRejectedValue(new Error("github exploded"));

    const { res, text } = await send({ url: "https://github.com/o/r" });

    expect(res.status).toBe(200);
    // JSON route: headers. Stream: a result frame with a stale marker. Same salvaged report either way.
    expect(text).toContain('"headSha":"old"');
    if (name === "/api/scan") {
      expect(res.headers.get("x-ascent-stale")).toBe("true");
      expect(res.headers.get("x-ascent-fallback")).toBe("error");
    } else {
      expect(text).toContain("event: stale");
      expect(text).toContain("event: result");
      expect(text).not.toContain("event: error");
    }
  });

  it("never salvages a PRIVATE snapshot out of the shared anonymous store", async () => {
    mockLatest.mockResolvedValue(
      reportOf({ repo: { owner: "o", name: "r", headSha: "old", isPrivate: true } }) as never,
    );
    mockScanRepo.mockRejectedValue(new Error("github exploded"));

    const { text } = await send({ url: "https://github.com/o/r" });

    expect(text).not.toContain('"headSha":"old"');
  });

  // ACCEPTANCE 8 - a private report must never land in the shared public corpus; the route-side
  // re-tenant was the "correct placement" half and existed on the JSON route only.
  it("re-tenants a PRIVATE report under the repo owner's org before persisting", async () => {
    mockDbOn.mockReturnValue(true);
    mockPersist.mockResolvedValue({ deduped: true } as never);
    mockScanRepo.mockResolvedValue(reportOf({ repo: { owner: "Acme", name: "r", headSha: "sha", isPrivate: true } }));

    await send({ url: "https://github.com/Acme/r" });

    expect(mockPersist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orgSlug: "acme" }));
  });

  // ACCEPTANCE 5 - a scoped request is never answered from the whole-repo entry, and never persisted.
  it("never answers a SCOPED request from the whole-repo cache entry, and never persists it", async () => {
    mockScope.mockResolvedValue({
      error: null,
      scope: { ref: "feature", refSha: "deadbeef" },
      pinSha: "deadbeef",
      requested: true,
    } as never);
    // The whole-repo entry for the default head IS warm - and answers a different question.
    mockLookup.mockResolvedValue(lookup(reportOf({ repo: { owner: "o", name: "r", headSha: "sha" } })));
    mockScopedLookup.mockReturnValue({ ...lookup(), cacheKey: "o/r@deadbeef::llm" });
    mockDbOn.mockReturnValue(true);
    mockPersist.mockResolvedValue({ deduped: false } as never);

    const { res } = await send({ url: "https://github.com/o/r", ref: "feature" });

    expect(res.status).toBe(200);
    expect(mockScanRepo).toHaveBeenCalledTimes(1); // it really scanned, instead of serving the whole-repo report
    expect(mockScanRepo.mock.calls[0]?.[1]).toMatchObject({ ref: "deadbeef" });
    expect(mockPersist).not.toHaveBeenCalled(); // a scoped report is about a different subject
  });

  it("keeps full cache reuse for a ref that resolves to the default head (NOT scoped)", async () => {
    mockScope.mockResolvedValue({
      error: null,
      scope: { ref: "main", refSha: "sha" },
      pinSha: "sha",
      requested: true,
    } as never);
    mockLookup.mockResolvedValue(lookup(reportOf({ repo: { owner: "o", name: "r", headSha: "sha" } })));

    const { res, text } = await send({ url: "https://github.com/o/r", ref: "main" });

    expect(res.status).toBe(200);
    expect(mockScopedLookup).not.toHaveBeenCalled();
    expect(mockScanRepo).not.toHaveBeenCalled(); // served from the whole-repo entry, as an ordinary scan
    if (name === "/api/scan") expect(res.headers.get("x-ascent-cache")).toBe("hit");
    else expect(text).toContain("event: result");
  });

  // ACCEPTANCE 4, route half - the quota axis of the refund ledger, which the anonymous public funnel
  // is the only path that can exercise (credit metering requires a token, which excludes the quota).
  //
  // One row is route-aware on PURPOSE, and it is the only legitimate difference between the two: the
  // JSON route serves a cache hit BEFORE its gates (so no slot was ever consumed and there is nothing
  // to hand back), while the stream must consume before it can open the stream and therefore refunds.
  // Both call the SAME ledger method (`onCacheHit`); what differs is whether a slot exists to refund.
  const QUOTA_LEDGER = [
    {
      situation: "cached hit",
      arrange: () => mockLookup.mockResolvedValue(lookup(reportOf())),
      refunds: name === "/api/scan" ? 0 : 1,
    },
    {
      situation: "degrade-to-mock",
      arrange: () => mockScanRepo.mockResolvedValue(reportOf({ engine: { provider: "mock", model: "m" } })),
      refunds: 1,
    },
    {
      situation: "dedup",
      arrange: () => {
        mockDbOn.mockReturnValue(true);
        mockPersist.mockResolvedValue({ deduped: true } as never);
      },
      refunds: 0,
    },
    { situation: "thrown error", arrange: () => mockScanRepo.mockRejectedValue(new Error("boom")), refunds: 1 },
    {
      situation: "client abort",
      arrange: () => {
        const abort = new Error("aborted");
        abort.name = "AbortError";
        mockScanRepo.mockRejectedValue(abort);
      },
      refunds: 1,
    },
    { situation: "real new scan", arrange: () => {}, refunds: 0 },
  ] as const;

  it.each(QUOTA_LEDGER)("refund ledger (quota): $situation -> x$refunds", async ({ arrange, refunds }) => {
    arrange();
    await send({ url: "https://github.com/o/r" });
    expect(mockQuotaRefund).toHaveBeenCalledTimes(refunds);
  });

  // ACCEPTANCE 4, credit axis - a metered (private / installed-org) scan.
  const CREDIT_LEDGER = [
    {
      situation: "degrade-to-mock",
      arrange: () => mockScanRepo.mockResolvedValue(reportOf({ engine: { provider: "mock", model: "m" } })),
      refunds: 1,
    },
    {
      situation: "dedup",
      arrange: () => {
        mockDbOn.mockReturnValue(true);
        mockPersist.mockResolvedValue({ deduped: true } as never);
      },
      refunds: 1,
    },
    { situation: "thrown error", arrange: () => mockScanRepo.mockRejectedValue(new Error("boom")), refunds: 1 },
    { situation: "real new scan", arrange: () => {}, refunds: 0 },
  ] as const;

  it.each(CREDIT_LEDGER)("refund ledger (credit): $situation -> x$refunds", async ({ arrange, refunds }) => {
    mockAuth.mockResolvedValue({ orgSlug: "acme", token: "ghs_x" } as Awaited<ReturnType<typeof resolveScanAuth>>);
    mockMetered.mockReturnValue(true);
    mockEntitlement.mockResolvedValue({
      allowed: true,
      unlimited: false,
      balance: 5,
      withinAllowance: false,
      allowanceRemaining: 0,
    } as Awaited<ReturnType<typeof checkScanEntitlement>>);
    arrange();

    await send({ url: "https://github.com/o/r" });

    expect(mockCreditRefund).toHaveBeenCalledTimes(refunds);
    // A metered scan is per-tenant: it never touches the shared anonymous quota, on either route.
    expect(mockQuotaRefund).not.toHaveBeenCalled();
  });
});
