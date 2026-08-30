// Route test for the FREE control-probe cron (GET /api/cron/probe, moonshot #10).
//
// Two things must hold, and both are cheap to lose:
//   (1) the cron gate is the shared fail-closed one — this route mints installation tokens, so it is
//       credentialed work even though it spends no credits;
//   (2) it spends NOTHING. The probe lane's whole premise is that control freshness is decoupled from
//       LLM spend, so a drain here must never reach the scanner or the credit core. Asserted
//       structurally (the module's import graph) as well as behaviourally.

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
vi.mock("@/lib/db/scan-jobs", () => ({ queueDepth: vi.fn(async () => ({ probe: { queued: 3, oldestAgeMs: 1000 } })) }));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: vi.fn(() => true) }));
vi.mock("@/lib/scan-queue-worker", () => ({ drainLane: vi.fn() }));

import { GET, maxDuration } from "./route";
import { drainLane } from "@/lib/scan-queue-worker";
import { PROBE_CONCURRENCY } from "@/lib/pool";

const mockDrain = vi.mocked(drainLane);
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
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("auth", () => {
  it("fails CLOSED with no CRON_SECRET (503) and drains nothing", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(mockDrain).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer (401) and drains nothing", async () => {
    const res = await GET(req("Bearer nope"));
    expect(res.status).toBe(401);
    expect(mockDrain).not.toHaveBeenCalled();
  });

  it("drains the PROBE lane on a correct bearer, at the probe concurrency", async () => {
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(mockDrain).toHaveBeenCalledTimes(1);
    expect(mockDrain.mock.calls[0]![0]).toBe("probe");
    expect(mockDrain.mock.calls[0]![1].concurrency).toBe(PROBE_CONCURRENCY);
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
