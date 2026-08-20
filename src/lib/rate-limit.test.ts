import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clientIp,
  rateLimitRequest,
  rateLimitRequestShared,
  tooManyRequests,
  rateLimiterStats,
  __resetRateLimiterState,
  SCAN_RATE_LIMIT,
  PEEK_RATE_LIMIT,
  QUOTA_PEEK_RATE_LIMIT,
  ORG_IMPORT_RATE_LIMIT,
  GATE_RATE_LIMIT,
  CONTACT_RATE_LIMIT,
  BADGE_RATE_LIMIT,
  type RateLimitConfig,
} from "./rate-limit";
import {
  createUpstashStore,
  sharedWindowStore,
  __setSharedWindowStore,
  SHARED_STORE_BREAKER_MS,
  type SharedWindowStore,
} from "./rate-limit-store";

// IMPORTANT: `rate-limit.ts` keeps its sliding-window state in a MODULE-GLOBAL `Map` that is not
// exported and cannot be reset between tests. To keep tests isolated and deterministic we give
// every test a UNIQUE config `name` (and, where it matters, a unique IP), so each test counts
// against fresh per-IP and global buckets that no other test has touched.
let uid = 0;
function freshName(prefix = "t"): string {
  uid += 1;
  return `${prefix}-${uid}-${Math.random().toString(36).slice(2)}`;
}

const WINDOW_MS = 60_000;

function makeConfig(over: Partial<RateLimitConfig> = {}): RateLimitConfig {
  return {
    name: freshName(),
    perIp: 3,
    global: 100, // high so per-IP trips first unless a test overrides it
    windowMs: WINDOW_MS,
    basis: "inherited", // test fixtures are not derived from any client cadence; say so
    ...over,
  };
}

function reqFromIp(ip: string): Request {
  // `x-real-ip` is the trusted platform header `clientIp` prefers first.
  return new Request("https://example.test/api/scan", {
    headers: { "x-real-ip": ip },
  });
}

describe("clientIp — IP trust boundary (critical #2)", () => {
  it("prefers x-real-ip over any X-Forwarded-For", () => {
    const req = new Request("https://example.test", {
      headers: {
        "x-real-ip": "9.9.9.9",
        "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3",
      },
    });
    expect(clientIp(req)).toBe("9.9.9.9");
  });

  it("with only XFF, returns the RIGHT-most (trusted-proxy-appended) hop, not the spoofable left-most", () => {
    const req = new Request("https://example.test", {
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" },
    });
    // 1.1.1.1 is the client-supplied left-most (spoofable); 3.3.3.3 is what the trusted proxy appended.
    expect(clientIp(req)).toBe("3.3.3.3");
  });

  it("a client-controlled left-most XFF entry can NEVER change the returned key (invariant)", () => {
    // Same trusted proxy hop, two different attacker-chosen left-most values → same key.
    const a = clientIp(
      new Request("https://example.test", {
        headers: { "x-forwarded-for": "evil-A, 10.0.0.7" },
      }),
    );
    const b = clientIp(
      new Request("https://example.test", {
        headers: { "x-forwarded-for": "evil-B, 10.0.0.7" },
      }),
    );
    expect(a).toBe("10.0.0.7");
    expect(b).toBe("10.0.0.7");
    expect(a).toBe(b); // attacker cannot mint a fresh bucket by varying the left-most hop
  });

  it("trims whitespace around the trusted XFF hop", () => {
    const req = new Request("https://example.test", {
      headers: { "x-forwarded-for": "1.1.1.1 ,  4.4.4.4  " },
    });
    expect(clientIp(req)).toBe("4.4.4.4");
  });

  // ── ASCENT_TRUSTED_PROXY_HOPS — the deployment-shape trust knob (quotas-rate-limiting 07-16 #1) ──
  describe("ASCENT_TRUSTED_PROXY_HOPS", () => {
    afterEach(() => {
      delete process.env.ASCENT_TRUSTED_PROXY_HOPS;
    });

    it("0 (no trusted proxy): ignores BOTH x-real-ip and XFF — a spoofed x-real-ip cannot mint fresh buckets", () => {
      process.env.ASCENT_TRUSTED_PROXY_HOPS = "0";
      const req = new Request("https://example.test", {
        headers: { "x-real-ip": "6.6.6.6", "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
      });
      // Headers are attacker-writable on this deploy shape → collective "unknown" bucket (fail closed;
      // the 30-day quota's bucketContext treats it as unidentifiable and fails open instead).
      expect(clientIp(req)).toBe("unknown");
    });

    it("2 (CDN → LB chain): picks the 2nd-from-the-right XFF hop and does NOT trust x-real-ip", () => {
      process.env.ASCENT_TRUSTED_PROXY_HOPS = "2";
      const req = new Request("https://example.test", {
        headers: {
          "x-real-ip": "203.0.113.9", // set by an intermediate hop — names the wrong peer
          "x-forwarded-for": "evil, 198.51.100.7, 203.0.113.9", // client per the 2-hop chain: 198.51.100.7
        },
      });
      // The right-most hop is the CDN edge's own IP — bucketing on it would collapse every real user
      // into one bucket and lock the whole anonymous funnel out of the monthly quota.
      expect(clientIp(req)).toBe("198.51.100.7");
    });

    it("a chain SHORTER than the declared trusted depth yields 'unknown' (never a spoofable left-most hop)", () => {
      process.env.ASCENT_TRUSTED_PROXY_HOPS = "3";
      const req = new Request("https://example.test", {
        headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
      });
      expect(clientIp(req)).toBe("unknown");
    });

    it("unset / invalid values keep the default single-proxy platform behavior", () => {
      const mk = () =>
        new Request("https://example.test", {
          headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 3.3.3.3" },
        });
      expect(clientIp(mk())).toBe("9.9.9.9");
      process.env.ASCENT_TRUSTED_PROXY_HOPS = "not-a-number";
      expect(clientIp(mk())).toBe("9.9.9.9");
    });
  });

  it("ignores empty XFF segments and still returns the right-most real hop", () => {
    const req = new Request("https://example.test", {
      headers: { "x-forwarded-for": "1.1.1.1, , 5.5.5.5, ," },
    });
    expect(clientIp(req)).toBe("5.5.5.5");
  });

  it("trims whitespace on x-real-ip", () => {
    const req = new Request("https://example.test", {
      headers: { "x-real-ip": "  7.7.7.7  " },
    });
    expect(clientIp(req)).toBe("7.7.7.7");
  });

  it("falls back to the single shared 'unknown' bucket when no identifying header is present (fail closed)", () => {
    const req = new Request("https://example.test");
    expect(clientIp(req)).toBe("unknown");
  });

  it("falls back to 'unknown' when XFF is present but all hops are empty", () => {
    const req = new Request("https://example.test", {
      headers: { "x-forwarded-for": " , , " },
    });
    expect(clientIp(req)).toBe("unknown");
  });

  it("an empty x-real-ip falls through to the XFF right-most hop", () => {
    const req = new Request("https://example.test", {
      headers: { "x-real-ip": "   ", "x-forwarded-for": "1.1.1.1, 8.8.8.8" },
    });
    expect(clientIp(req)).toBe("8.8.8.8");
  });
});

describe("rateLimitRequest — enforce-and-trip (critical #1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to the per-IP limit, then trips on the (limit+1)-th hit within the window", () => {
    const cfg = makeConfig({ perIp: 3, global: 1000 });
    const req = reqFromIp("203.0.113.1");

    // First `perIp` hits are allowed (recent.length <= limit).
    for (let i = 1; i <= 3; i++) {
      const r = rateLimitRequest(req, cfg);
      expect(r.ok, `hit #${i} should be allowed`).toBe(true);
      expect(r.retryAfterSec).toBe(0);
    }
    // The 4th (limit+1) hit within the same window trips.
    const tripped = rateLimitRequest(req, cfg);
    expect(tripped.ok).toBe(false);
    expect(tripped.retryAfterSec).toBe(Math.ceil(WINDOW_MS / 1000)); // 60
  });

  it("re-allows after the window fully elapses (the window slides)", () => {
    const cfg = makeConfig({ perIp: 2, global: 1000 });
    const req = reqFromIp("203.0.113.2");

    expect(rateLimitRequest(req, cfg).ok).toBe(true); // hit 1
    expect(rateLimitRequest(req, cfg).ok).toBe(true); // hit 2 (fills the limit)
    expect(rateLimitRequest(req, cfg).ok).toBe(false); // hit 3 → tripped

    // Advance just past the window so the two prior in-window hits age out (cutoff = now - windowMs,
    // filter keeps t > cutoff, so move strictly beyond windowMs).
    vi.advanceTimersByTime(WINDOW_MS + 1);

    const after = rateLimitRequest(req, cfg);
    expect(after.ok).toBe(true); // window slid → allowed again
    expect(after.retryAfterSec).toBe(0);
  });

  it("does NOT re-allow while still inside the window (hits at the edge still count)", () => {
    const cfg = makeConfig({ perIp: 2, global: 1000 });
    const req = reqFromIp("203.0.113.3");

    expect(rateLimitRequest(req, cfg).ok).toBe(true); // hit 1 @ t0
    expect(rateLimitRequest(req, cfg).ok).toBe(true); // hit 2 @ t0

    // Advance to exactly the window boundary: the original hits are at now-windowMs, and the filter
    // keeps t > cutoff (strict), so a hit landing exactly windowMs later sees them dropped... but a
    // hit landing one ms BEFORE the boundary must still see them and trip.
    vi.advanceTimersByTime(WINDOW_MS - 1);
    expect(rateLimitRequest(req, cfg).ok).toBe(false); // still within window → tripped
  });

  it("global backstop trips independently of per-IP: distinct IPs each under their per-IP cap still trip the global ceiling", () => {
    // perIp generous so no single IP ever trips its own bucket; global is the real cap here.
    const cfg = makeConfig({ perIp: 50, global: 3 });

    // 3 DISTINCT IPs, each making exactly ONE request → none trips per-IP, but 3 hits fill global.
    expect(rateLimitRequest(reqFromIp("198.51.100.1"), cfg).ok).toBe(true); // global hit 1
    expect(rateLimitRequest(reqFromIp("198.51.100.2"), cfg).ok).toBe(true); // global hit 2
    expect(rateLimitRequest(reqFromIp("198.51.100.3"), cfg).ok).toBe(true); // global hit 3 (fills)

    // A 4th distinct IP, still under its own per-IP cap, trips because the GLOBAL window is full.
    const tripped = rateLimitRequest(reqFromIp("198.51.100.4"), cfg);
    expect(tripped.ok).toBe(false);
    expect(tripped.retryAfterSec).toBe(Math.ceil(WINDOW_MS / 1000));
  });

  it("per-IP and global are independent budgets, not a shared key: one IP tripping per-IP does not exhaust an under-cap global for other IPs", () => {
    const cfg = makeConfig({ perIp: 2, global: 100 });

    const noisy = reqFromIp("192.0.2.10");
    expect(rateLimitRequest(noisy, cfg).ok).toBe(true); // per-IP 1, global 1
    expect(rateLimitRequest(noisy, cfg).ok).toBe(true); // per-IP 2, global 2
    expect(rateLimitRequest(noisy, cfg).ok).toBe(false); // per-IP 3 → tripped on per-IP only

    // A different IP is still fine: global has plenty of headroom and its own per-IP bucket is empty.
    const other = reqFromIp("192.0.2.11");
    expect(rateLimitRequest(other, cfg).ok).toBe(true);
  });

  it("QUOTA #1: a request over its per-IP cap does NOT consume the shared global budget (no DoS amplification)", () => {
    // One abuser floods past its per-IP cap; the global ceiling is small. Before the fix, every
    // rejected over-per-IP request still charged the global window, so the abuser drained the global
    // pool and other IPs got 429'd. After the fix, over-per-IP requests are rejected WITHOUT charging
    // global, so a fresh IP still passes (global was only charged for the abuser's ALLOWED requests).
    const cfg = makeConfig({ perIp: 2, global: 5 });
    const abuser = reqFromIp("203.0.113.50");

    expect(rateLimitRequest(abuser, cfg).ok).toBe(true); // per-IP 1, global 1
    expect(rateLimitRequest(abuser, cfg).ok).toBe(true); // per-IP 2, global 2 (per-IP now full)
    // 20 further floods: all rejected on per-IP, and crucially none should charge global.
    for (let i = 0; i < 20; i++) {
      expect(rateLimitRequest(abuser, cfg).ok).toBe(false); // tripped on per-IP only
    }
    // global has only seen the abuser's 2 ALLOWED hits, so 3 more distinct IPs (global budget 5) pass.
    expect(rateLimitRequest(reqFromIp("203.0.113.51"), cfg).ok).toBe(true); // global 3
    expect(rateLimitRequest(reqFromIp("203.0.113.52"), cfg).ok).toBe(true); // global 4
    expect(rateLimitRequest(reqFromIp("203.0.113.53"), cfg).ok).toBe(true); // global 5 (fills)
    // Only NOW, with the global window genuinely full of distinct callers, does the next IP trip global.
    expect(rateLimitRequest(reqFromIp("203.0.113.54"), cfg).ok).toBe(false);
  });

  it("retryAfter tracks the sliding edge: a trip partway through the window reports the remaining wait, not a full window", () => {
    // Sliding-window correctness: the slot frees when the OLDEST in-window hit ages out
    // (recent[0] + windowMs), not after a fixed full window from the trip. A caller whose oldest hit
    // is already 58s old should be told ~2s, not 60s.
    const cfg = makeConfig({ perIp: 1, global: 1000, windowMs: WINDOW_MS });
    const req = reqFromIp("203.0.113.77");
    expect(rateLimitRequest(req, cfg).ok).toBe(true); // hit 1 @ t0 fills per-IP(1)

    vi.advanceTimersByTime(WINDOW_MS - 2000); // 58s later, the t0 hit ages out in 2s
    const tripped = rateLimitRequest(req, cfg);
    expect(tripped.ok).toBe(false);
    expect(tripped.retryAfterSec).toBe(2); // ceil((t0 + 60000 - (t0+58000)) / 1000) = 2, NOT 60
  });

  it("retryAfter is clamped to at least 1s even when the oldest hit is on the verge of aging out", () => {
    const cfg = makeConfig({ perIp: 1, global: 1000, windowMs: WINDOW_MS });
    const req = reqFromIp("203.0.113.78");
    expect(rateLimitRequest(req, cfg).ok).toBe(true); // hit 1 @ t0

    vi.advanceTimersByTime(WINDOW_MS - 1); // 1ms before the t0 hit ages out
    const tripped = rateLimitRequest(req, cfg);
    expect(tripped.ok).toBe(false);
    expect(tripped.retryAfterSec).toBe(1); // max(1, ceil(1/1000)) = 1, never 0 on a trip
  });

  it("reports the larger retryAfter when both windows are tripped simultaneously", () => {
    const cfg = makeConfig({ perIp: 1, global: 1, windowMs: WINDOW_MS });
    const req = reqFromIp("203.0.113.9");
    expect(rateLimitRequest(req, cfg).ok).toBe(true); // fills both per-IP(1) and global(1)
    const tripped = rateLimitRequest(req, cfg);
    expect(tripped.ok).toBe(false);
    // Both windows share windowMs here, so retryAfter is ceil(windowMs/1000).
    expect(tripped.retryAfterSec).toBe(Math.ceil(WINDOW_MS / 1000));
  });

  it("different config `name`s do not share a budget (namespacing)", () => {
    const a = makeConfig({ name: freshName("scan"), perIp: 1, global: 1000 });
    const b = makeConfig({ name: freshName("badge"), perIp: 1, global: 1000 });
    const req = reqFromIp("203.0.113.20");

    expect(rateLimitRequest(req, a).ok).toBe(true);
    expect(rateLimitRequest(req, a).ok).toBe(false); // a's per-IP(1) exhausted
    // Same IP under a DIFFERENT namespace has its own fresh bucket.
    expect(rateLimitRequest(req, b).ok).toBe(true);
  });

  it("the 'unknown' fallback bucket is shared collectively across unidentifiable callers (fail closed)", () => {
    const cfg = makeConfig({ perIp: 2, global: 1000 });
    const anon = () => new Request("https://example.test/api/scan"); // no IP headers → "unknown"

    expect(rateLimitRequest(anon(), cfg).ok).toBe(true); // unknown hit 1
    expect(rateLimitRequest(anon(), cfg).ok).toBe(true); // unknown hit 2 (fills)
    // A THIRD unidentifiable caller shares the same "unknown" bucket → tripped, not a fresh bucket.
    expect(rateLimitRequest(anon(), cfg).ok).toBe(false);
  });
});

describe("rateLimitRequest — QUOTA #2: the ceiling drains instead of self-perpetuating", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a GLOBAL-rejected request is NOT recorded, so a brief spike drains and recovers on schedule", () => {
    // perIp huge so no single IP ever trips its own bucket — the GLOBAL ceiling is the subject here.
    const cfg = makeConfig({ perIp: 10_000, global: 2, windowMs: WINDOW_MS });

    // t0: two admitted requests fill the global window.
    expect(rateLimitRequest(reqFromIp("10.0.0.1"), cfg).ok).toBe(true); // global 1 @ t0
    expect(rateLimitRequest(reqFromIp("10.0.0.2"), cfg).ok).toBe(true); // global 2 @ t0 (full)
    // t0: a 3rd request is rejected (global full) — the fix requires it NOT to be recorded.
    expect(rateLimitRequest(reqFromIp("10.0.0.3"), cfg).ok).toBe(false);

    // 30s in, sustained under-cap traffic keeps arriving — every one rejected (global still holds the
    // two @ t0). Under the OLD record-before-check code each of these would push the window forward.
    vi.advanceTimersByTime(WINDOW_MS / 2); // t0 + 30s
    for (let i = 0; i < 25; i++) {
      expect(rateLimitRequest(reqFromIp(`10.0.1.${i}`), cfg).ok).toBe(false);
    }

    // Past t0 + windowMs the ORIGINAL two hits age out. Because the intervening rejected requests were
    // never recorded, the window is now empty and a fresh request is ADMITTED. The old code would keep
    // this 429'd until t0 + 90s (the rejected @t0+30s hits would still occupy the window) — the
    // sustained instance-wide lockout this fix removes.
    vi.advanceTimersByTime(WINDOW_MS / 2 + 1); // t0 + 60_001ms
    expect(rateLimitRequest(reqFromIp("10.0.2.7"), cfg).ok).toBe(true); // RECOVERED on schedule
  });

  it("per-IP: rejected over-cap hammering likewise does not extend the lockout past the real hit", () => {
    const cfg = makeConfig({ perIp: 1, global: 10_000, windowMs: WINDOW_MS });
    const ip = reqFromIp("10.9.9.9");
    expect(rateLimitRequest(ip, cfg).ok).toBe(true); // the ONE real hit @ t0 fills per-IP(1)

    // Hammer for 30s — all rejected, none recorded (advances to t0 + 30s total).
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(3_000);
      expect(rateLimitRequest(ip, cfg).ok).toBe(false);
    }
    // Advance just past t0 + windowMs so the only recorded hit (@ t0) ages out. The rejected hammering
    // did NOT push the window forward, so the IP is admitted again exactly when its real hit expires.
    vi.advanceTimersByTime(WINDOW_MS - 30_000 + 1); // now t0 + 60_001ms
    expect(rateLimitRequest(ip, cfg).ok).toBe(true);
  });
});

describe("rateLimitRequest — spoofing cannot evade the per-IP bucket (critical #2 end-to-end)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("varying the spoofable left-most XFF entry does NOT mint fresh per-IP buckets", () => {
    const cfg = makeConfig({ perIp: 2, global: 1000 });
    const trustedHop = "10.10.10.10"; // appended by the trusted proxy (right-most)

    const spoofed = (left: string) =>
      new Request("https://example.test/api/scan", {
        headers: { "x-forwarded-for": `${left}, ${trustedHop}` },
      });

    // Three requests, each with a DIFFERENT attacker-chosen left-most hop, all share the trusted key.
    expect(rateLimitRequest(spoofed("evil-1"), cfg).ok).toBe(true); // hit 1 on 10.10.10.10
    expect(rateLimitRequest(spoofed("evil-2"), cfg).ok).toBe(true); // hit 2 on 10.10.10.10 (fills)
    expect(rateLimitRequest(spoofed("evil-3"), cfg).ok).toBe(false); // hit 3 → tripped despite new left-most
  });
});

describe("real exported configs pin the as-written limits", () => {
  // Importing the configs after a clean module load uses the env fallbacks (no env overrides set in
  // the test environment), pinning the documented defaults.
  it("SCAN/ORG_IMPORT/BADGE defaults match the source", async () => {
    const mod = await import("./rate-limit");
    expect(mod.SCAN_RATE_LIMIT).toMatchObject({
      name: "scan",
      perIp: 20,
      global: 120,
      windowMs: 60_000,
    });
    expect(mod.ORG_IMPORT_RATE_LIMIT).toMatchObject({
      name: "org-import",
      perIp: 3,
      global: 15,
      windowMs: 60_000,
    });
    expect(mod.BADGE_RATE_LIMIT).toMatchObject({
      name: "badge",
      perIp: 60,
      global: 600,
      windowMs: 60_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// G1-04: the GLOBAL ceiling backed by a SHARED store (cross-instance).
//
// "Instances" are simulated by building SEPARATE store objects (createUpstashStore) over ONE fake
// Redis backend — that is exactly the production shape: N processes, N clients, 1 store. Per-IP
// buckets stay in-process, so every request below uses a DISTINCT IP and the per-IP cap never trips;
// what trips is the shared budget.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A minimal in-process stand-in for the Upstash REST `/pipeline` endpoint (sorted sets only). */
function fakeUpstash() {
  const zsets = new Map<string, { score: number; member: string }[]>();
  let calls = 0;
  let fail = false;

  function run(cmd: (string | number)[]): unknown {
    const op = String(cmd[0]).toUpperCase();
    const key = String(cmd[1]);
    const z = zsets.get(key) ?? [];
    switch (op) {
      case "ZREMRANGEBYSCORE": {
        const max = Number(cmd[3]);
        zsets.set(key, z.filter((e) => e.score > max));
        return 0;
      }
      case "ZADD": {
        z.push({ score: Number(cmd[2]), member: String(cmd[3]) });
        z.sort((a, b) => a.score - b.score);
        zsets.set(key, z);
        return 1;
      }
      case "ZCARD":
        return z.length;
      case "ZRANGE": {
        const slice = z.slice(Number(cmd[2]), Number(cmd[3]) + 1);
        return slice.flatMap((e) => [e.member, String(e.score)]);
      }
      case "ZREM": {
        zsets.set(key, z.filter((e) => e.member !== String(cmd[2])));
        return 1;
      }
      case "PEXPIRE":
        return 1;
      default:
        throw new Error(`fakeUpstash: unsupported ${op}`);
    }
  }

  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    if (fail) throw new Error("ECONNREFUSED");
    const commands = JSON.parse(String(init?.body)) as (string | number)[][];
    const out = commands.map((c) => ({ result: run(c) }));
    return new Response(JSON.stringify(out), { status: 200 });
  });

  return {
    fetchImpl,
    size: (key: string) => (zsets.get(key) ?? []).length,
    get calls() {
      return calls;
    },
    breakStore: () => {
      fail = true;
    },
  };
}

describe("shared store — the global ceiling holds ACROSS instances (G1-04)", () => {
  let backend: ReturnType<typeof fakeUpstash>;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    backend = fakeUpstash();
    globalThis.fetch = backend.fetchImpl as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    __setSharedWindowStore(undefined);
    vi.unstubAllEnvs();
  });

  it("N instances sharing one store enforce ONE budget, not N × budget", async () => {
    const cfg = makeConfig({ perIp: 50, global: 3 });
    // Three independent "instances", each with its own client object over the same backend.
    const instances = [0, 1, 2].map(() => createUpstashStore("https://fake.upstash", "tkn"));
    const send = async (i: number, ip: string) => {
      __setSharedWindowStore(instances[i]!);
      return rateLimitRequestShared(reqFromIp(ip), cfg);
    };

    expect((await send(0, "192.0.2.1")).ok).toBe(true); // instance A
    expect((await send(1, "192.0.2.2")).ok).toBe(true); // instance B
    expect((await send(2, "192.0.2.3")).ok).toBe(true); // instance C — budget now full
    // A fourth request on a FRESH instance would have been admitted under per-process state.
    const tripped = await send(0, "192.0.2.4");
    expect(tripped.ok).toBe(false);
    expect(tripped.retryAfterSec).toBeGreaterThan(0);
    expect(tripped.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it("a rejected shared hit is UN-recorded, so the shared window can drain", async () => {
    const cfg = makeConfig({ perIp: 50, global: 2 });
    const key = `ascent:rl:${cfg.name}:__global__`;
    __setSharedWindowStore(createUpstashStore("https://fake.upstash", "tkn"));

    expect((await rateLimitRequestShared(reqFromIp("198.18.0.1"), cfg)).ok).toBe(true);
    expect((await rateLimitRequestShared(reqFromIp("198.18.0.2"), cfg)).ok).toBe(true);
    expect((await rateLimitRequestShared(reqFromIp("198.18.0.3"), cfg)).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 0)); // the compensating ZREM is fire-and-forget
    expect(backend.size(key)).toBe(2); // only the two ADMITTED hits are in the window
  });

  it("a per-IP-rejected request never charges the shared budget (QUOTA #1 across the network)", async () => {
    const cfg = makeConfig({ perIp: 1, global: 10 });
    __setSharedWindowStore(createUpstashStore("https://fake.upstash", "tkn"));
    expect((await rateLimitRequestShared(reqFromIp("198.18.1.1"), cfg)).ok).toBe(true);
    const callsAfterAdmit = backend.calls;
    expect((await rateLimitRequestShared(reqFromIp("198.18.1.1"), cfg)).ok).toBe(false);
    expect(backend.calls).toBe(callsAfterAdmit); // the store was never touched
  });
});

describe("shared store — in-memory remains the default and behaves as today", () => {
  afterEach(() => {
    __setSharedWindowStore(undefined);
    vi.unstubAllEnvs();
  });

  it("no ASCENT_RATE_LIMIT_STORE → sharedWindowStore() is null (no infrastructure needed)", () => {
    __setSharedWindowStore(undefined);
    vi.stubEnv("ASCENT_RATE_LIMIT_STORE", "");
    expect(sharedWindowStore()).toBeNull();
  });

  it("upstash selected but credentials missing → still in-memory (a bad env var can't 500 the funnel)", () => {
    __setSharedWindowStore(undefined);
    vi.stubEnv("ASCENT_RATE_LIMIT_STORE", "upstash");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(sharedWindowStore()).toBeNull();
  });

  it("with no store, rateLimitRequestShared trips on the in-memory global exactly like the sync path", async () => {
    __setSharedWindowStore(null);
    const cfg = makeConfig({ perIp: 50, global: 2 });
    expect((await rateLimitRequestShared(reqFromIp("203.0.114.1"), cfg)).ok).toBe(true);
    expect((await rateLimitRequestShared(reqFromIp("203.0.114.2"), cfg)).ok).toBe(true);
    const tripped = await rateLimitRequestShared(reqFromIp("203.0.114.3"), cfg);
    expect(tripped.ok).toBe(false);
    expect(tripped.retryAfterSec).toBeGreaterThan(0);
  });

  it("with no store, the per-IP burst window is still in-memory and still trips", async () => {
    __setSharedWindowStore(null);
    const cfg = makeConfig({ perIp: 2, global: 100 });
    const ip = reqFromIp("203.0.115.9");
    expect((await rateLimitRequestShared(ip, cfg)).ok).toBe(true);
    expect((await rateLimitRequestShared(ip, cfg)).ok).toBe(true);
    expect((await rateLimitRequestShared(ip, cfg)).ok).toBe(false);
  });
});

describe("shared store unreachable — the deliberate FAIL-CLOSED choice", () => {
  const unreachable: SharedWindowStore = { kind: "dead", hit: async () => null };

  afterEach(() => {
    __setSharedWindowStore(undefined);
    vi.unstubAllEnvs();
  });

  it("rejects (429-worthy) by default — a denial-of-wallet is worse than a denied free scan", async () => {
    __setSharedWindowStore(unreachable);
    const cfg = makeConfig({ perIp: 50, global: 100 });
    const r = await rateLimitRequestShared(reqFromIp("198.51.101.1"), cfg);
    expect(r.ok).toBe(false);
    // A refusal that never EVALUATED a limit says so, and its Retry-After is the breaker's re-probe
    // delay (when a real answer becomes possible) — not the one-full-window figure it used to give,
    // which is the shape of a drain estimate for a window that was never counted.
    expect(r.scope).toBe("unavailable");
    expect(r.evaluated).toBe(false);
    expect(r.retryAfterSec).toBe(Math.ceil(SHARED_STORE_BREAKER_MS / 1000));
    expect(r.limit).toBeUndefined(); // nothing was measured, so no ceiling may be quoted
  });

  it("ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN=1 degrades to the in-memory ceiling instead", async () => {
    __setSharedWindowStore(unreachable);
    vi.stubEnv("ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN", "1");
    const cfg = makeConfig({ perIp: 50, global: 2 });
    expect((await rateLimitRequestShared(reqFromIp("198.51.102.1"), cfg)).ok).toBe(true);
    expect((await rateLimitRequestShared(reqFromIp("198.51.102.2"), cfg)).ok).toBe(true);
    // Degraded, but NOT unlimited: the in-memory ceiling still bites.
    expect((await rateLimitRequestShared(reqFromIp("198.51.102.3"), cfg)).ok).toBe(false);
  });

  it("a transport failure marks the store unavailable and opens a breaker (no timeout per request)", async () => {
    const backend = fakeUpstash();
    const realFetch = globalThis.fetch;
    globalThis.fetch = backend.fetchImpl as unknown as typeof fetch;
    try {
      backend.breakStore();
      const store = createUpstashStore("https://fake.upstash", "tkn");
      expect(await store.hit("k", 5, 60_000)).toBeNull();
      expect(backend.calls).toBe(1);
      expect(await store.hit("k", 5, 60_000)).toBeNull(); // breaker open → no second network call
      expect(backend.calls).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("tooManyRequests response helper", () => {
  it("returns a 429 with a numeric Retry-After header and JSON error body", async () => {
    const res = tooManyRequests(60);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});

describe("a refusal names the limit, the window and the layer that refused (naked-429)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    __setSharedWindowStore(undefined);
  });

  it("a PER-IP refusal carries scope, limiter, limit and window â€” the caller can act on it", async () => {
    const cfg = makeConfig({ name: freshName("mine"), perIp: 1, global: 100 });
    const req = reqFromIp("192.0.2.77");
    expect(rateLimitRequest(req, cfg).ok).toBe(true);
    const r = rateLimitRequest(req, cfg);

    expect(r.ok).toBe(false);
    expect(r.scope).toBe("ip");
    expect(r.limiter).toBe(cfg.name);
    expect(r.limit).toBe(1);
    expect(r.windowSec).toBe(60);
    expect(r.evaluated).toBe(true);

    const res = tooManyRequests(r);
    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("ip");
    expect(res.headers.get("x-ascent-ratelimit-limit")).toBe("1");
    expect(res.headers.get("x-ascent-ratelimit-window")).toBe("60");
    const body = (await res.json()) as { error: string; scope: string; limit: number; code: string };
    expect(body.scope).toBe("ip");
    expect(body.code).toBe("rate_limited");
    expect(body.limit).toBe(1);
    expect(body.error).toContain("1 request per 60s"); // the limit and window are IN the prose too
  });

  it("a GLOBAL refusal is distinguishable from a per-IP one but does NOT publish the ceiling", async () => {
    const cfg = makeConfig({ name: freshName("theirs"), perIp: 50, global: 1 });
    expect(rateLimitRequest(reqFromIp("192.0.2.80"), cfg).ok).toBe(true); // fills the global
    const r = rateLimitRequest(reqFromIp("192.0.2.81"), cfg); // a DIFFERENT, innocent caller

    expect(r.ok).toBe(false);
    expect(r.scope).toBe("global");
    // The risk this guards: echoing the global ceiling (or the headroom left) tells an attacker
    // exactly how much traffic exhausts the instance budget and how close they are to it.
    expect(r.limit).toBeUndefined();
    expect(r.windowSec).toBeUndefined();

    const res = tooManyRequests(r);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("global");
    expect(res.headers.get("x-ascent-ratelimit-limit")).toBeNull();
    const text = await res.text();
    expect(text).toContain("service-wide");
    expect(text).toContain("not caused by your traffic alone");
    expect(text).not.toContain('"limit"');
  });

  it("an UNEVALUATED refusal (store unreachable) says no limit was evaluated", async () => {
    __setSharedWindowStore({ kind: "dead", hit: async () => null });
    const cfg = makeConfig({ name: freshName("dead"), perIp: 50, global: 100 });
    const r = await rateLimitRequestShared(reqFromIp("192.0.2.90"), cfg);

    const res = tooManyRequests(r);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("unavailable");
    expect(res.headers.get("retry-after")).toBe(String(Math.ceil(SHARED_STORE_BREAKER_MS / 1000)));
    const body = (await res.json()) as { code: string; evaluated: boolean };
    expect(body.code).toBe("rate_limit_unavailable");
    expect(body.evaluated).toBe(false);
  });

  it("the legacy numeric call shape still returns the old prose (routes not yet switched)", async () => {
    const res = tooManyRequests(42);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBeNull();
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Please slow down");
  });
});

describe("every limit declares how its number was arrived at (limit-derivation)", () => {
  // The point of the field: an operator tuning under load must be able to tell a load-bearing,
  // recomputable ceiling from one that was merely carried forward. If a future entry is genuinely
  // derived, this list changes AND the comment above it must show the arithmetic.
  const inThisModule = [
    SCAN_RATE_LIMIT,
    PEEK_RATE_LIMIT,
    QUOTA_PEEK_RATE_LIMIT,
    ORG_IMPORT_RATE_LIMIT,
    GATE_RATE_LIMIT,
    CONTACT_RATE_LIMIT,
    BADGE_RATE_LIMIT,
  ];

  it("declares a basis on every exported budget", () => {
    for (const cfg of inThisModule) {
      expect(["derived", "inherited"], `${cfg.name} must declare a basis`).toContain(cfg.basis);
    }
  });

  it("labels the budgets in this module INHERITED â€” none was computed from a measured cadence", () => {
    for (const cfg of inThisModule) {
      expect(cfg.basis, `${cfg.name} claims to be derived; show the arithmetic above it`).toBe("inherited");
    }
  });

  it("BADGE is inherited by record, not by omission (it was matched to a previous bespoke limit)", () => {
    expect(BADGE_RATE_LIMIT.basis).toBe("inherited");
    expect(BADGE_RATE_LIMIT.perIp).toBe(60); // the value it inherited from the badge route
  });
});

describe("the reaper: a declared cadence, a bounded sweep and a metric (reaper-opportunistic)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
    __resetRateLimiterState();
  });
  afterEach(() => {
    vi.useRealTimers();
    __resetRateLimiterState();
  });

  const cfg = () => makeConfig({ perIp: 5, global: 1_000_000, windowMs: WINDOW_MS });

  it("sweeps on a cadence, not on every request", () => {
    const c = cfg();
    for (let i = 0; i < 50; i += 1) rateLimitRequest(reqFromIp(`10.1.0.${i}`), c);
    // 50 requests inside the same instant â†’ the cadence gate allows at most the first sweep.
    expect(rateLimiterStats().sweeps).toBe(1);

    vi.advanceTimersByTime(10_000); // one SWEEP_INTERVAL_MS
    rateLimitRequest(reqFromIp("10.1.1.1"), c);
    expect(rateLimiterStats().sweeps).toBe(2);
  });

  it("reclaims fully-aged keys, and reports what it reclaimed", () => {
    const c = cfg();
    for (let i = 1; i <= 20; i += 1) rateLimitRequest(reqFromIp(`10.2.0.${i}`), c);
    expect(rateLimiterStats().keys).toBeGreaterThanOrEqual(20);

    // Past the window, every one of those keys is fully aged. Drive enough ticks to complete a pass.
    for (let t = 0; t < 12; t += 1) {
      vi.advanceTimersByTime(10_000);
      rateLimitRequest(reqFromIp("10.2.9.9"), c);
    }
    const s = rateLimiterStats();
    expect(s.evicted).toBeGreaterThanOrEqual(20);
    expect(s.passes).toBeGreaterThanOrEqual(1);
    expect(s.scanned).toBeGreaterThan(0);
    expect(s.peakKeys).toBeGreaterThanOrEqual(20);
  });

  it("NEVER evicts a key whose window still holds hits â€” an eviction would reset the limit", () => {
    // The trap: a bounded reaper that drops not-fully-aged keys hands an attacker a way to exceed
    // the limit by forcing evictions. A live key must survive any number of sweeps.
    const c = makeConfig({ perIp: 2, global: 1_000_000 });
    const victim = reqFromIp("10.3.0.1");
    expect(rateLimitRequest(victim, c).ok).toBe(true);
    expect(rateLimitRequest(victim, c).ok).toBe(true); // per-IP window now full

    // Half a window of sweeps, with plenty of unrelated churn to keep the reaper busy.
    for (let t = 0; t < 3; t += 1) {
      vi.advanceTimersByTime(10_000);
      for (let i = 0; i < 20; i += 1) rateLimitRequest(reqFromIp(`10.3.${t + 1}.${i}`), c);
    }
    expect(rateLimiterStats().sweeps).toBeGreaterThan(1);
    // Still refused: the window survived the sweeps rather than being reset by them.
    expect(rateLimitRequest(victim, c).ok).toBe(false);
  });

  it("a sweep is bounded â€” a huge map costs a bounded number of inspections per tick", () => {
    const c = cfg();
    for (let i = 0; i < 600; i += 1) rateLimitRequest(reqFromIp(`10.4.${Math.floor(i / 250)}.${i % 250}`), c);
    const before = rateLimiterStats().scanned;
    vi.advanceTimersByTime(10_000);
    rateLimitRequest(reqFromIp("10.4.9.9"), c);
    const inspected = rateLimiterStats().scanned - before;
    expect(inspected).toBeLessThanOrEqual(256); // SWEEP_BUDGET, not windows.size
    expect(inspected).toBeGreaterThan(0);
  });
});

