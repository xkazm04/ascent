import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clientIp,
  rateLimitRequest,
  tooManyRequests,
  type RateLimitConfig,
} from "./rate-limit";

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
