// Route test for the FREE control-probe cron (GET /api/cron/probe, moonshot #10).
//
// Three things must hold, and all are cheap to lose:
//   (1) the cron gate is the shared fail-closed one — this route mints installation tokens, so it is
//       credentialed work even though it spends no credits;
//   (2) it spends NOTHING. The probe lane's whole premise is that control freshness is decoupled from
//       LLM spend, so a drain here must never reach the scanner or the credit core. Asserted
//       structurally (the module's import graph) as well as behaviourally;
//   (3) ORDER — seed watched repos, then drain. Without the seed, App-installed orgs only probe on
//       webhook and never stamp missingSince for a silent 404 (`listOrgRepos` never runs for them).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn(() => true) }));
vi.mock("@/lib/db/scan-jobs", () => ({
  enqueueDueProbes: vi.fn(async () => 0),
  queueDepth: vi.fn(async () => ({ probe: { queued: 3, oldestAgeMs: 1000 } })),
}));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: vi.fn(() => true) }));
vi.mock("@/lib/scan-queue-worker", () => ({ drainLane: vi.fn() }));

import { GET, maxDuration } from "./route";
import { drainLane } from "@/lib/scan-queue-worker";
import { enqueueDueProbes } from "@/lib/db/scan-jobs";
import { PROBE_CONCURRENCY } from "@/lib/pool";

const mockDrain = vi.mocked(drainLane);
const mockSeed = vi.mocked(enqueueDueProbes);
const SECRET = "probe-secret-xyz";

const summary = () => ({
  claimed: 2,
  done: 2,
  failed: 0,
  skipped: 0,
  skippedForCredits: 0,
  skippedNoToken: 0,
  truncated: false,
  errors: [],
});

function req(auth?: string) {
  return new Request("http://localhost/api/cron/probe", auth ? { headers: { authorization: auth } } : undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  mockDrain.mockResolvedValue(summary());
  mockSeed.mockResolvedValue(0);
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("auth", () => {
  const nothingRan = () => {
    expect(mockSeed).not.toHaveBeenCalled();
    expect(mockDrain).not.toHaveBeenCalled();
  };

  it("fails CLOSED with no CRON_SECRET (503) and drains nothing", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    nothingRan();
  });

  it("rejects a wrong bearer (401) and drains nothing", async () => {
    const res = await GET(req("Bearer nope"));
    expect(res.status).toBe(401);
    nothingRan();
  });

  it("drains the PROBE lane on a correct bearer, at the probe concurrency", async () => {
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockDrain).toHaveBeenCalledTimes(1);
    expect(mockDrain.mock.calls[0]![0]).toBe("probe");
    expect(mockDrain.mock.calls[0]![1].concurrency).toBe(PROBE_CONCURRENCY);
  });
});

describe("seed then drain", () => {
  it("seeds watched repos BEFORE draining, so a pass can probe what it just enqueued", async () => {
    mockSeed.mockResolvedValue(4);
    await GET(req(`Bearer ${SECRET}`));

    expect(mockSeed).toHaveBeenCalledTimes(1);
    expect(mockSeed).toHaveBeenCalledWith();
    expect(mockSeed.mock.invocationCallOrder[0]!).toBeLessThan(mockDrain.mock.invocationCallOrder[0]!);
  });

  it("reports how many NEW cadence jobs this pass seeded (idempotent, so often 0)", async () => {
    mockSeed.mockResolvedValue(4);
    const body = (await (await GET(req(`Bearer ${SECRET}`))).json()) as { seeded: number; lane: string };
    expect(body.lane).toBe("probe");
    expect(body.seeded).toBe(4);
  });
});

describe("the lane is free", () => {
  it("keeps its own, much smaller budget (a probe is seconds, not minutes)", () => {
    expect(maxDuration).toBe(60);
  });

  it("imports neither the scanner nor the credit core", () => {
    const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/scan-credit/);
    expect(src).not.toMatch(/from "@\/lib\/scan"/);
  });

  it("reports the lane depth AFTER the drain, so an oversubscribed schedule is visible", async () => {
    const body = (await (await GET(req(`Bearer ${SECRET}`))).json()) as { queueDepth: unknown; done: number };
    expect(body.done).toBe(2);
    expect(body.queueDepth).toEqual({ queued: 3, oldestAgeMs: 1000 });
  });
});
