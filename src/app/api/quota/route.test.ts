// GET /api/quota — the read-only quota peek must be rate-limited like every other public surface
// (quotas-rate-limiting 07-16 #2): before this, each anonymous request ran auth resolution plus a
// per-request DB read with `no-store`, making the free funnel's cheapest endpoint an unauthenticated
// amplification lever. Uses the REAL `rateLimitRequestShared` (no store configured → in-memory
// windows, same as the sync path) with distinct per-test IPs so tests don't share buckets.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init),
  },
}));
vi.mock("@/lib/public-scan-quota", () => ({
  peekPublicScanQuota: vi.fn(async () => ({ enforced: true, remaining: 5, limit: 5, resetAt: null, scope: "anon" })),
}));
vi.mock("@/lib/access", () => ({ getViewer: vi.fn(async () => null) }));

import { GET } from "./route";
import { peekPublicScanQuota } from "@/lib/public-scan-quota";

const mockPeek = vi.mocked(peekPublicScanQuota);

function req(ip: string) {
  return new Request("http://localhost/api/quota", { headers: { "x-real-ip": ip } });
}

beforeEach(() => {
  // x-real-ip is meaningful here because the fixture represents one trusted proxy.
  vi.stubEnv("ASCENT_TRUSTED_PROXY_HOPS", "1");
  vi.clearAllMocks();
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/quota — rate limit on the public peek", () => {
  it("charges rateLimitRequestShared, not the in-process limiter", () => {
    // The in-process entry (`rateLimitRequest`) and the shared entry share in-memory windows when
    // no store is configured, so a 61-hit trip would still go green after a regression to the
    // sync path. The call site is the thing that actually changed: fleet-wide global ceiling.
    const src = readFileSync(join(process.cwd(), "src/app/api/quota/route.ts"), "utf8");
    expect(src).toMatch(/await rateLimitRequestShared\(\s*request,\s*QUOTA_PEEK_RATE_LIMIT\s*\)/);
    expect(src).not.toMatch(/\brateLimitRequest\(/);
  });

  it("serves the quota payload (no-store) under the limit", async () => {
    const res = await GET(req("10.0.0.1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ enforced: true, remaining: 5 });
  });

  it("429s with Retry-After once one IP exceeds the per-minute budget — and stops reading the DB", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 61; i++) last = await GET(req("10.0.0.2"));
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    // The 61st request must be rejected BEFORE the quota/DB read — 60 admitted reads, not 61.
    expect(mockPeek).toHaveBeenCalledTimes(60);
  });

  it("names the scope of the refusal — per-IP, with the budget and window the caller must fit", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 61; i++) last = await GET(req("10.0.0.3"));
    expect(last!.status).toBe(429);
    // The route passes the whole RateLimitResult, so the refusal is self-describing: the caller can
    // tell "you are calling too often" from "the fleet budget is spent" without reading our logs.
    expect(last!.headers.get("x-ascent-ratelimit-scope")).toBe("ip");
    const body = await last!.json();
    expect(body).toMatchObject({ code: "rate_limited", scope: "ip" });
    expect(body.limiter).toBeTruthy();
    expect(body.limit).toBeGreaterThan(0);
    expect(body.windowSec).toBeGreaterThan(0);
  });
});
