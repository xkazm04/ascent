// The one limiter charge pipeline (rate-limit-charge.ts), pinned through the three public entry points
// it serves - rateLimitRequest, rateLimitKeyed, rateLimitRequestShared - so the tests hold whichever
// file the rule lives in.
//
// Two properties:
//   1. THE CALLER'S SLOT IS RESERVED BEFORE THE SHARED-STORE AWAIT. The old shared path checked the
//      per-IP window, awaited the store, and only then recorded the hit, so N same-IP requests in flight
//      together all saw the pre-burst count and all passed the per-IP cap. A slow fake store makes that
//      race observable. A reservation that ends in a global or unavailable refusal is released (QUOTA #3).
//   2. EVERY REFUSAL IS COUNTED ONCE, BY LIMITER AND LAYER, by the pipeline itself: `rate_limit` scoped
//      by limiter name for the caller's own budget, `<limiter>:global` for the shared one, and a store
//      outage on its own `rate_limit_unavailable` kind, which counted nothing and is not abuse.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockRecord } = vi.hoisted(() => ({ mockRecord: vi.fn<(kind: string, scope: string) => Promise<void>>(async () => {}) }));
vi.mock("@/lib/db/quota-events", () => ({ recordQuotaEvent: mockRecord }));

import {
  rateLimitRequest,
  rateLimitKeyed,
  rateLimitRequestShared,
  __resetRateLimiterState,
  SCAN_RATE_LIMIT,
  PEEK_RATE_LIMIT,
  GATE_RATE_LIMIT,
  MCP_RATE_LIMIT,
  type RateLimitConfig,
  type RateLimitResult,
} from "@/lib/rate-limit";
import { __setSharedWindowStore, type SharedWindowHit, type SharedWindowStore } from "@/lib/rate-limit-store";

const req = () => new Request("https://ascent.test/api/scan", { method: "POST" });

/** A shared store that answers every hit with `answer` after `delayMs`, like a real network hop. */
function slowStore(answer: SharedWindowHit | null, delayMs = 20): SharedWindowStore {
  return {
    hit: () => new Promise((resolve) => setTimeout(() => resolve(answer), delayMs)),
  } as SharedWindowStore;
}

const burst = (n: number, cfg: RateLimitConfig) =>
  Promise.all(Array.from({ length: n }, () => rateLimitRequestShared(req(), cfg)));

const count = (rs: RateLimitResult[], pred: (r: RateLimitResult) => boolean) => rs.filter(pred).length;

beforeEach(() => {
  __resetRateLimiterState();
  mockRecord.mockClear();
  delete process.env.ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN;
});
afterEach(() => __setSharedWindowStore(undefined));

describe("the caller's slot is reserved before the shared-store await", () => {
  it("a 25-way same-IP burst against a slow store admits exactly the per-IP cap", async () => {
    __setSharedWindowStore(slowStore({ ok: true, retryAfterSec: 0 }));
    const rs = await burst(25, SCAN_RATE_LIMIT);
    expect(SCAN_RATE_LIMIT.perIp).toBe(20);
    expect(count(rs, (r) => r.ok)).toBe(20);
    const refused = rs.filter((r) => !r.ok);
    expect(refused).toHaveLength(5);
    for (const r of refused) {
      expect(r.scope).toBe("ip");
      expect(r.evaluated).toBe(true);
    }
  });

  it("a burst the store refuses globally releases every reserved slot (QUOTA #3 under concurrency)", async () => {
    __setSharedWindowStore(slowStore({ ok: false, retryAfterSec: 9 }));
    const rs = await burst(25, SCAN_RATE_LIMIT);
    expect(count(rs, (r) => r.ok)).toBe(0);
    // 20 held a reservation through the await and were refused by the shared layer; the 5 that arrived
    // while 20 were in flight were refused by the caller's own cap and reserved nothing.
    expect(count(rs, (r) => r.scope === "global")).toBe(20);
    expect(count(rs, (r) => r.scope === "ip")).toBe(5);
    // Every reservation was released: a later sequential burst gets the caller's full allowance.
    __setSharedWindowStore(slowStore({ ok: true, retryAfterSec: 0 }, 0));
    const later: RateLimitResult[] = [];
    for (let i = 0; i < 21; i += 1) later.push(await rateLimitRequestShared(req(), SCAN_RATE_LIMIT));
    expect(count(later, (r) => r.ok)).toBe(20);
    expect(later[20]!.scope).toBe("ip");
  });

  it("an unreachable store (fail closed) releases the slot and counts an outage, not a trip", async () => {
    __setSharedWindowStore(slowStore(null));
    const r = await rateLimitRequestShared(req(), SCAN_RATE_LIMIT);
    expect(r.ok).toBe(false);
    expect(r.scope).toBe("unavailable");
    expect(r.evaluated).toBe(false);
    expect(mockRecord).toHaveBeenCalledWith("rate_limit_unavailable", "scan");
    expect(mockRecord.mock.calls.some(([kind]) => kind === "rate_limit")).toBe(false);
    // Released: the caller still has its whole budget once the store answers again.
    __setSharedWindowStore(slowStore({ ok: true, retryAfterSec: 0 }, 0));
    const after = await burst(20, SCAN_RATE_LIMIT);
    expect(count(after, (x) => x.ok)).toBe(20);
  });
});

describe("the pipeline counts every refusal by limiter and layer", () => {
  it("a per-IP peek refusal is counted under its own limiter, scan-peek", () => {
    for (let i = 0; i < PEEK_RATE_LIMIT.perIp; i += 1) expect(rateLimitRequest(req(), PEEK_RATE_LIMIT).ok).toBe(true);
    const r = rateLimitRequest(req(), PEEK_RATE_LIMIT);
    expect(r.scope).toBe("ip");
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledWith("rate_limit", "scan-peek");
  });

  it("the gate and mcp doors count their refusals too", () => {
    for (let i = 0; i < GATE_RATE_LIMIT.perIp; i += 1) rateLimitRequest(req(), GATE_RATE_LIMIT);
    expect(rateLimitRequest(req(), GATE_RATE_LIMIT).ok).toBe(false);
    expect(mockRecord).toHaveBeenCalledWith("rate_limit", "gate");

    for (let i = 0; i < MCP_RATE_LIMIT.perIp; i += 1) rateLimitKeyed("tok_1", MCP_RATE_LIMIT);
    expect(rateLimitKeyed("tok_1", MCP_RATE_LIMIT).ok).toBe(false);
    expect(mockRecord).toHaveBeenCalledWith("rate_limit", "mcp");
    expect(mockRecord).toHaveBeenCalledTimes(2);
  });

  it("a global-layer refusal is counted on '<limiter>:global', on the sync and the shared door", async () => {
    const door: RateLimitConfig = { name: "test-door", perIp: 5, global: 1, windowMs: 60_000, basis: "inherited" };
    expect(rateLimitKeyed("a", door).ok).toBe(true);
    expect(rateLimitKeyed("b", door).scope).toBe("global");
    expect(mockRecord).toHaveBeenCalledWith("rate_limit", "test-door:global");

    __setSharedWindowStore(slowStore({ ok: false, retryAfterSec: 9 }, 0));
    expect((await rateLimitRequestShared(req(), SCAN_RATE_LIMIT)).scope).toBe("global");
    expect(mockRecord).toHaveBeenCalledWith("rate_limit", "scan:global");
    expect(mockRecord).toHaveBeenCalledTimes(2);
  });

  it("an admitted request records nothing", async () => {
    rateLimitRequest(req(), GATE_RATE_LIMIT);
    rateLimitKeyed("tok", MCP_RATE_LIMIT);
    await rateLimitRequestShared(req(), SCAN_RATE_LIMIT);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe("guard: with no shared store the async door is the sync door", () => {
  it("returns the same verdict sequence as rateLimitRequest for the same requests", async () => {
    const door: RateLimitConfig = { name: "seq", perIp: 3, global: 5, windowMs: 60_000, basis: "inherited" };
    __setSharedWindowStore(null);
    const shared: (RateLimitResult & { scope?: string })[] = [];
    for (let i = 0; i < 6; i += 1) shared.push(await rateLimitRequestShared(req(), door));
    __resetRateLimiterState();
    const sync: RateLimitResult[] = [];
    for (let i = 0; i < 6; i += 1) sync.push(rateLimitRequest(req(), door));
    expect(shared.map((r) => [r.ok, r.scope])).toEqual(sync.map((r) => [r.ok, r.scope]));
  });
});
