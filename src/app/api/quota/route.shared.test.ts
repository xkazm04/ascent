// GET /api/quota — the shared limiter's refusal shapes (global / unavailable) cannot be produced
// by the in-process `rateLimitRequest` entry. This file mocks `rateLimitRequestShared` so those
// branches are reachable, and uses the REAL `tooManyRequests` so the 429 is the one the route emits.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init),
  },
}));
vi.mock("@/lib/public-scan-quota", () => ({
  peekPublicScanQuota: vi.fn(async () => ({ enforced: true, remaining: 5, limit: 5, resetAt: null, scope: "anon" })),
}));
vi.mock("@/lib/access", () => ({ getViewer: vi.fn(async () => null) }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    rateLimitRequestShared: vi.fn(async () => ({ ok: true, retryAfterSec: 0 })),
  };
});

import { GET } from "./route";
import { peekPublicScanQuota } from "@/lib/public-scan-quota";
import { rateLimitRequestShared, QUOTA_PEEK_RATE_LIMIT } from "@/lib/rate-limit";

const mockPeek = vi.mocked(peekPublicScanQuota);
const mockShared = vi.mocked(rateLimitRequestShared);

function req(ip: string) {
  return new Request("http://localhost/api/quota", { headers: { "x-real-ip": ip } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockShared.mockResolvedValue({ ok: true, retryAfterSec: 0 });
});

describe("GET /api/quota — charges rateLimitRequestShared", () => {
  it("passes the quota-peek budget to the shared limiter before any DB read", async () => {
    const res = await GET(req("203.0.113.10"));
    expect(res.status).toBe(200);
    expect(mockShared).toHaveBeenCalledTimes(1);
    expect(mockShared.mock.calls[0]?.[1]).toEqual(QUOTA_PEEK_RATE_LIMIT);
    expect(mockPeek).toHaveBeenCalledTimes(1);
  });

  it("global refusal names the fleet scope and never reads the quota", async () => {
    mockShared.mockResolvedValue({
      ok: false,
      retryAfterSec: 12,
      scope: "global",
      limiter: "quota-peek",
      evaluated: true,
    });
    const res = await GET(req("203.0.113.11"));
    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("global");
    const body = await res.json();
    expect(body).toMatchObject({ code: "rate_limited", scope: "global", limiter: "quota-peek" });
    // Publishing the fleet ceiling would turn this public peek into a capacity probe.
    expect(body.limit).toBeUndefined();
    expect(body.windowSec).toBeUndefined();
    expect(res.headers.get("x-ascent-ratelimit-limit")).toBeNull();
    expect(mockPeek).not.toHaveBeenCalled();
  });

  it("an unevaluated refusal says the shared store did not answer, and does not claim overspend", async () => {
    mockShared.mockResolvedValue({
      ok: false,
      retryAfterSec: 5,
      scope: "unavailable",
      limiter: "quota-peek",
      evaluated: false,
    });
    const res = await GET(req("203.0.113.12"));
    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("unavailable");
    expect(await res.json()).toMatchObject({
      code: "rate_limit_unavailable",
      scope: "unavailable",
      evaluated: false,
      limiter: "quota-peek",
    });
    expect(mockPeek).not.toHaveBeenCalled();
  });
});
