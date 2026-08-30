// Route test for the unattended autoscan cron (GET /api/cron/rescan). This is the only fully
// unattended scan path — no human watching an SSE stream — so its gate and its orchestration are
// pinned here from every side:
//   (1) AUTH GATE — a missing CRON_SECRET fails closed (503) and a wrong bearer/key is rejected
//       (401); in neither case does anything reap, seed or drain (the gate already regressed to
//       fail-open once, so it is pinned shut from both sides).
//   (2) ORDER — reap, then seed, then drain. Reaping first is what makes a process-killed pass
//       self-heal instead of stranding claimed rows; seeding before draining is what lets a single
//       pass pick up work it just enqueued.
//   (3) HONEST REMAINDER — the response reports the queue's own depth, read AFTER the drain, rather
//       than a count this invocation guessed at.
//
// WHAT MOVED (moonshot #10), so nothing here is silently lost: claim-before-spend, reserve-before-
// inference, the refund boundary, the cadence settle and the BYOM/public exemptions are now
// `src/lib/scan-queue-worker.ts`, shared with /api/org/scan and /api/org/import, and tested in
// `src/lib/scan-queue-worker.test.ts`. The claim itself is a `ScanJob` row, not `nextScanAt`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn(() => true) }));
vi.mock("@/lib/db/scan-jobs", () => ({
  enqueueDueRescans: vi.fn(async () => 0),
  queueDepth: vi.fn(async () => ({ rescore: { queued: 0, oldestAgeMs: null }, probe: { queued: 0, oldestAgeMs: null } })),
  reapExpiredLeases: vi.fn(async () => 0),
}));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: vi.fn(() => true) }));
vi.mock("@/lib/scan-queue-worker", () => ({ drainLane: vi.fn() }));

import { GET, maxDuration } from "./route";
import { enqueueDueRescans, queueDepth, reapExpiredLeases } from "@/lib/db/scan-jobs";
import { drainLane } from "@/lib/scan-queue-worker";
import { isAppConfigured } from "@/lib/github/app";
import { SCAN_CONCURRENCY } from "@/lib/pool";

const mockSeed = vi.mocked(enqueueDueRescans);
const mockReap = vi.mocked(reapExpiredLeases);
const mockDepth = vi.mocked(queueDepth);
const mockDrain = vi.mocked(drainLane);
const mockAppConfigured = vi.mocked(isAppConfigured);

const SECRET = "cron-secret-xyz";

const summary = (over: Record<string, unknown> = {}) => ({
  claimed: 0,
  done: 0,
  failed: 0,
  skipped: 0,
  skippedForCredits: 0,
  skippedNoToken: 0,
  truncated: false,
  errors: [],
  ...over,
});

function req(opts: { auth?: string; key?: string } = {}) {
  const url = opts.key ? `http://localhost/api/cron/rescan?key=${opts.key}` : "http://localhost/api/cron/rescan";
  return new Request(url, opts.auth ? { headers: { authorization: opts.auth } } : undefined);
}

async function body(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  process.env.CRON_SECRET = SECRET;
  delete process.env.CRON_ALLOW_QUERY_KEY;
  mockAppConfigured.mockReturnValue(true);
  mockDrain.mockResolvedValue(summary());
  mockSeed.mockResolvedValue(0);
  mockReap.mockResolvedValue(0);
  mockDepth.mockResolvedValue({ rescore: { queued: 0, oldestAgeMs: null }, probe: { queued: 0, oldestAgeMs: null } });
});
afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.CRON_ALLOW_QUERY_KEY;
});

describe("GET /api/cron/rescan — the auth gate stays shut", () => {
  const nothingRan = () => {
    expect(mockReap).not.toHaveBeenCalled();
    expect(mockSeed).not.toHaveBeenCalled();
    expect(mockDrain).not.toHaveBeenCalled();
  };

  it("fails CLOSED with 503 when CRON_SECRET is unset — and reaps/seeds/drains nothing", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req({ auth: `Bearer ${SECRET}` }))).status).toBe(503);
    nothingRan();
  });

  it("rejects a wrong bearer with 401", async () => {
    expect((await GET(req({ auth: "Bearer nope" }))).status).toBe(401);
    nothingRan();
  });

  it("rejects a request with NO credential at all", async () => {
    expect((await GET(req())).status).toBe(401);
    nothingRan();
  });

  it("REFUSES a correct ?key= secret by default — a query string is a logged channel", async () => {
    expect((await GET(req({ key: SECRET }))).status).toBe(401);
    nothingRan();
  });

  it("accepts a correct ?key= only behind the CRON_ALLOW_QUERY_KEY deprecation flag", async () => {
    process.env.CRON_ALLOW_QUERY_KEY = "1";
    expect((await GET(req({ key: SECRET }))).status).toBe(200);
    expect(mockDrain).toHaveBeenCalled();
  });

  it("skips (200, no work) when the GitHub App isn't configured", async () => {
    mockAppConfigured.mockReturnValue(false);
    const res = await GET(req({ auth: `Bearer ${SECRET}` }));
    expect((await body(res)).skipped).toBeTruthy();
    nothingRan();
  });
});

describe("GET /api/cron/rescan — reap, seed, drain", () => {
  it("runs the three phases IN ORDER: a stranded claim is reaped before anything is seeded or drained", async () => {
    await GET(req({ auth: `Bearer ${SECRET}` }));

    expect(mockReap.mock.invocationCallOrder[0]!).toBeLessThan(mockSeed.mock.invocationCallOrder[0]!);
    expect(mockSeed.mock.invocationCallOrder[0]!).toBeLessThan(mockDrain.mock.invocationCallOrder[0]!);
  });

  it("seeds EVERYTHING due — no 100-per-pass cap, because the queue now holds the backlog", async () => {
    await GET(req({ auth: `Bearer ${SECRET}` }));
    // A limit argument would reintroduce the cap this change exists to remove.
    expect(mockSeed).toHaveBeenCalledWith();
  });

  it("drains the RESCORE lane at the scan concurrency, inside the invocation's own budget", async () => {
    await GET(req({ auth: `Bearer ${SECRET}` }));
    const opts = mockDrain.mock.calls[0]![1];
    expect(mockDrain.mock.calls[0]![0]).toBe("rescore");
    expect(opts.concurrency).toBe(SCAN_CONCURRENCY);
    // The deadline reserves finalize headroom inside the platform ceiling, so the route can still
    // RETURN a body instead of being process-killed mid-scan.
    expect(opts.deadlineAt).toBeLessThan(Date.now() + maxDuration * 1000);
  });

  it("reports the queue's own depth, read AFTER the drain — not a guess by this invocation", async () => {
    mockDrain.mockResolvedValue(summary({ done: 4, claimed: 4, truncated: true }));
    mockDepth.mockResolvedValue({ rescore: { queued: 96, oldestAgeMs: 900 }, probe: { queued: 0, oldestAgeMs: null } });

    const out = await body(await GET(req({ auth: `Bearer ${SECRET}` })));

    expect(mockDepth.mock.invocationCallOrder[0]!).toBeGreaterThan(mockDrain.mock.invocationCallOrder[0]!);
    expect(out).toMatchObject({ scanned: 4, truncated: true, queueDepth: { queued: 96, oldestAgeMs: 900 } });
  });

  it("reports the worker's own outcome buckets — a skip is never counted as a scan", async () => {
    mockDrain.mockResolvedValue(summary({ done: 2, failed: 1, skipped: 3, skippedForCredits: 1, skippedNoToken: 2, errors: ["acme/x: boom"] }));

    const out = await body(await GET(req({ auth: `Bearer ${SECRET}` })));

    expect(out).toMatchObject({
      scanned: 2,
      failed: 1,
      skippedAlreadyClaimed: 3,
      skippedForCredits: 1,
      skippedNoToken: 2,
      errors: ["acme/x: boom"],
    });
  });

  it("a truncated pass is NOT a loss: it reports what is still queued for the next one", async () => {
    mockDrain.mockResolvedValue(summary({ done: 1, truncated: true }));
    mockDepth.mockResolvedValue({ rescore: { queued: 12, oldestAgeMs: 60_000 }, probe: { queued: 0, oldestAgeMs: null } });

    const out = await body(await GET(req({ auth: `Bearer ${SECRET}` })));

    expect(out.truncated).toBe(true);
    expect((out.queueDepth as { queued: number }).queued).toBe(12);
  });
});
