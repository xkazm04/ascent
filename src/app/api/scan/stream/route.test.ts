// Integration test for the SSE scan route's mock-cache-poisoning guard (scan-and-decide idea
// efc80ce5). The stream route carries its own copy of the degradedToMock guard, so it gets its
// own test to keep the two route copies from drifting. The stream is drained via response.text()
// so the ReadableStream's start() runs to completion before we assert on cacheSet.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
// `real.on` switches this mock from the passthrough (every suite below, which exercises the real
// cache-write path without a coalescer in the way) to the ACTUAL coalescer — which the rejoin suite at
// the bottom needs, because the linger window IS the behaviour under test there.
const coalescer = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cache")>();
  return {
    cacheSet: vi.fn(),
    cacheDelete: actual.cacheDelete,
    inflightScanCount: actual.inflightScanCount,
    // Passthrough: run the scan factory directly so these tests exercise the real cache-write path.
    coalesceScan: (...args: Parameters<typeof actual.coalesceScan>) =>
      coalescer.on
        ? actual.coalesceScan(...args)
        : args[1](new AbortController().signal, () => {}),
  };
});
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
  orgNotFound: () => new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }),
  scanCreditRefusal: (decision: { reason: "not_found" } | { reason: "payment_required"; balance: number }) =>
    decision.reason === "not_found"
      ? new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 })
      : new Response(JSON.stringify({ code: "INSUFFICIENT_CREDITS", balance: decision.balance }), { status: 402 }),
}));
vi.mock("@/lib/scan-credit", () => ({
  reserveScanCredit: vi.fn(async () => ({ skip: false, reserved: true, balance: 4 })),
  refundScanCredit: vi.fn(async () => 5),
}));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, getViewer: vi.fn(async () => null) }));
// The free monthly slot, overridden ONLY by the rejoin suite (which asserts the joiner's slot is handed
// back). `quotaStub.refund` null means "use the real consume", so every other suite is untouched.
const quotaStub = vi.hoisted(() => ({ refund: null as null | (() => Promise<void>) }));
vi.mock("@/lib/scan-finalize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scan-finalize")>();
  return {
    ...actual,
    consumeScanQuota: async (req: Request, opts: Parameters<typeof actual.consumeScanQuota>[1]) =>
      quotaStub.refund
        ? { blocked: null, quotaRemaining: 4, quotaResetAt: null, quotaScope: "anon" as const, refund: quotaStub.refund }
        : actual.consumeScanQuota(req, opts),
  };
});

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

  it("answers 404 NOT_FOUND — not 402 INSUFFICIENT_CREDITS — when the org does not exist", async () => {
    mockEnt.mockResolvedValue({
      allowed: false,
      unlimited: false,
      balance: 0,
      withinAllowance: false,
      allowanceRemaining: 0,
      orgExists: false,
    } as Awaited<ReturnType<typeof checkScanEntitlement>>);

    const res = await post({ url: "o/r" });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(mockReserve).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("answers 404 when the reservation reports orgExists:false (org vanished after the read)", async () => {
    mockReserve.mockResolvedValue({ skip: true, reserved: false, balance: 0, orgExists: false });

    const res = await post({ url: "o/r" });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
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
    expect(mockReserve).toHaveBeenCalledWith("acme", "o/r", { actor: "system" });
    await res.text();
    // A real, newly-scored metered scan KEEPS its charge.
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("refunds the reservation when the scan degrades to mock", async () => {
    mockScan.mockResolvedValue(reportWith("mock"));

    await postAndDrain({ url: "o/r", mock: false });

    // The refund carries the debit's own repo and actor (no viewer here, so "system"), which is what
    // makes a `refund` ledger row joinable to the `scan` row it reverses.
    expect(mockRefund).toHaveBeenCalledWith("acme", true, { actor: "system", repoFullName: "o/r" });
  });

  it("refunds the reservation when the commit was already scored (dedup)", async () => {
    mockDbConfigured.mockReturnValue(true);
    mockPersist.mockResolvedValue({ deduped: true } as Awaited<ReturnType<typeof persistScanReport>>);

    await postAndDrain({ url: "o/r", mock: false });

    // The refund carries the debit's own repo and actor (no viewer here, so "system"), which is what
    // makes a `refund` ledger row joinable to the `scan` row it reverses.
    expect(mockRefund).toHaveBeenCalledWith("acme", true, { actor: "system", repoFullName: "o/r" });
  });

  it("refunds the reservation when the scan throws (upstream failure / client abort)", async () => {
    mockScan.mockRejectedValue(new Error("github exploded"));

    await postAndDrain({ url: "o/r", mock: false });

    // The refund carries the debit's own repo and actor (no viewer here, so "system"), which is what
    // makes a `refund` ledger row joinable to the `scan` row it reverses.
    expect(mockRefund).toHaveBeenCalledWith("acme", true, { actor: "system", repoFullName: "o/r" });
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

describe("POST /api/scan/stream — persisted SSE frame (address-bar rewrite contract)", () => {
  async function drainText(body: unknown): Promise<string> {
    const res = await POST(
      new Request("http://localhost/api/scan/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    return res.text();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ orgSlug: "public" });
    mockMetered.mockReturnValue(false);
    mockLookup.mockResolvedValue(lookup("o/r@sha::llm"));
    mockScan.mockResolvedValue({
      ...reportWith("gemini"),
      confidence: 0.9,
      repo: { owner: "o", name: "r", headSha: "sha" },
    } as unknown as ScanReport);
    mockDbConfigured.mockReturnValue(false);
  });

  it("emits persisted ok:false when the DB is off, before result", async () => {
    const text = await drainText({ url: "o/r" });
    expect(text).toMatch(/event: persisted\ndata: \{"ok":false\}/);
    expect(text.indexOf("event: persisted")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("event: persisted")).toBeLessThan(text.indexOf("event: result"));
  });

  it("emits persisted ok:true after a durable write", async () => {
    mockDbConfigured.mockReturnValue(true);
    // Dedup: the row already exists, so durable is true without firing the new-row alert path
    // (scan-alerts is unmocked in this file).
    mockPersist.mockResolvedValue({ deduped: true } as Awaited<ReturnType<typeof persistScanReport>>);
    const text = await drainText({ url: "o/r" });
    expect(text).toMatch(/event: persisted\ndata: \{"ok":true\}/);
    expect(text.indexOf("event: persisted")).toBeLessThan(text.indexOf("event: result"));
  });

  it("emits persisted ok:false for a degrade-to-mock report (not saved)", async () => {
    mockDbConfigured.mockReturnValue(true);
    mockScan.mockResolvedValue(reportWith("mock"));
    const text = await drainText({ url: "o/r", mock: false });
    expect(text).toMatch(/event: persisted\ndata: \{"ok":false\}/);
  });
});

// ── A RELOADED TAB REJOINS ITS LIVE SCAN (repo-report-shell-tabs #4) ─────────────────────────────
//
// A reload closes the old SSE connection strictly BEFORE the new request arrives, so the coalescer's
// refcount always passes through zero. It used to abort the shared run at that instant, which made the
// join path unreachable from a reload and threw away a multi-minute scan for a page refresh. With the
// linger window, these two SEQUENTIAL connections share one run: exactly one scanRepository call, the
// returning connection gets the result, and its own quota slot is handed back because it bought nothing.

describe("POST /api/scan/stream — a returning connection rejoins the lingering run", () => {
  const openStream = (body: unknown, signal?: AbortSignal) =>
    POST(
      new Request("http://localhost/api/scan/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      }),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    coalescer.on = true;
    quotaStub.refund = vi.fn(async () => {});
    mockAuth.mockResolvedValue({ orgSlug: "public" });
    mockMetered.mockReturnValue(false);
    mockDbConfigured.mockReturnValue(false);
    // A distinct key per run so the module-level in-flight map can't leak between tests.
    mockLookup.mockResolvedValue(lookup(`o/r@rejoin-${Math.random()}::llm`));
  });
  afterEach(() => {
    coalescer.on = false;
    quotaStub.refund = null;
  });

  it("scans ONCE across a disconnect-then-reconnect pair, and refunds the joiner's slot", async () => {
    let resolveScan!: (r: ScanReport) => void;
    mockScan.mockImplementation(
      () =>
        new Promise<ScanReport>((res) => {
          resolveScan = res;
        }),
    );
    const report = {
      ...reportWith("gemini"),
      confidence: 0.9,
      repo: { owner: "o", name: "r", headSha: "sha" },
    } as unknown as ScanReport;

    // Connection 1 opens and the scan starts.
    const abandoned = new AbortController();
    const res1 = await openStream({ url: "o/r" }, abandoned.signal);
    const drain1 = res1.text();
    await vi.waitFor(() => expect(mockScan).toHaveBeenCalledTimes(1));

    // ...then the tab reloads: this connection dies mid-scan.
    abandoned.abort();
    await new Promise((r) => setTimeout(r, 0));

    // Connection 2 arrives inside the linger window and must JOIN, not start a second scan.
    const res2 = await openStream({ url: "o/r" });
    const drain2 = res2.text();
    resolveScan(report);
    const text2 = await drain2;
    await drain1;

    expect(mockScan).toHaveBeenCalledTimes(1); // one ingest, one LLM completion — not two
    expect(text2).toContain("event: joined"); // and the returning tab is TOLD it rejoined
    expect(text2).toContain("event: result");
    // "Meter on commit, not attempt": the joiner consumed a free monthly slot before coalescing and
    // received the owner's computation, so that slot is handed back.
    expect(quotaStub.refund).toHaveBeenCalledTimes(1);
  });
});

// ── PRIVATE REPO ON THE AMBIENT TOKEN ────────────────────────────────────────────────────────────
//
// The 2e992323 leftover. With the App configured, an owner with no installation reaches the live scan
// on the operator PAT. A private repo that token can read must answer EXACTLY like a missing repo:
// same status, same SSE body, same headers, nothing cached or persisted. The ingest is emulated by
// what it does with its credential: a 404 from GitHub, or the ambient-token refusal in scan.ts when
// the PAT read a private repo; both throw the same NOT_FOUND. The real ambient-token guard runs.

import { GitHubError } from "@/lib/github/source";
import { resetRepoVisibilityMemo } from "@/lib/github/visibility";
import { PAT, githubFake, observe } from "../github-fake.fixture";

describe("POST /api/scan/stream — a private repo on the ambient token answers like a missing repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRepoVisibilityMemo();
    vi.stubGlobal("fetch", githubFake({ "acme/secret": { private: true, head: "a".repeat(40) } }).fetchImpl);
    vi.stubEnv("GITHUB_TOKEN", PAT);
    vi.stubEnv("GITHUB_APP_ID", "1");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "key");
    mockAuth.mockResolvedValue({ orgSlug: "public" });
    mockDbConfigured.mockReturnValue(true); // persistence is ON, so "nothing persisted" means something
    mockLookup.mockImplementation(async (o) => ({ cacheKey: `${o.parsed.repo}::llm`, headSha: null, etag: null, cached: null, source: null }));
    mockScan.mockImplementation(async (url, o = {}) => {
      const cred = o.token ?? (o.noAmbientToken ? undefined : process.env.GITHUB_TOKEN);
      const res = await fetch(`https://api.github.com/repos/${url}`, { headers: cred ? { authorization: `Bearer ${cred}` } : {} });
      const meta = res.ok ? ((await res.json()) as { private: boolean }) : null;
      if (!meta || (meta.private && !o.token)) throw new GitHubError("NOT_FOUND", "Repository not found or is private.", 404);
      return reportWith("gemini");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("same status, body and headers as a missing repo, and nothing cached or persisted", async () => {
    const existing = await observe(await post({ url: "acme/secret" }));
    const missing = await observe(await post({ url: "acme/no-such-repo" }));
    expect(existing).toEqual(missing);
    expect(existing.status).toBe(200);
    expect(existing.body).toContain("event: error");
    expect(existing.body).toContain('"code":"NOT_FOUND"');
    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(mockPersist).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
  });
});
