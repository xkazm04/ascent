// POST /api/mcp — the agent door's rate-limit refusal.
//
// This endpoint is driven by MCP clients and agents, which retry on a schedule rather than by
// judgement. A 429 that says only "slow down and try again shortly" gives such a client nothing to
// act on: it cannot tell its OWN budget (back off to the stated rate and it recovers) from the
// FLEET budget (backing off may not clear it at all) from the limiter never having run. The route
// now hands the whole RateLimitResult to `tooManyRequests`, so the refusal names its own scope.
//
// The real helper is used deliberately — a stub would only prove the route calls something.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init),
  },
}));
// The refusal is charged before any token crypto or tool dispatch, so these boundaries are stubbed
// only to keep their (DB / handler) module graphs out of this test.
vi.mock("@/lib/db", () => ({ verifyOrgApiToken: vi.fn(async () => null) }));
vi.mock("@/lib/mcp/handlers", () => ({ runTool: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    rateLimitRequest: vi.fn(() => ({ ok: true, retryAfterSec: 0 })),
    tooManyRequests: actual.tooManyRequests,
    GATE_RATE_LIMIT: {},
  };
});

import { POST } from "./route";
import { verifyOrgApiToken } from "@/lib/db";
import { rateLimitRequest } from "@/lib/rate-limit";

const mockLimiter = vi.mocked(rateLimitRequest);
const mockVerify = vi.mocked(verifyOrgApiToken);

/** No Origin header: a non-browser client, which `originAllowed` permits (the normal agent case). */
function post() {
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer askl_test" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLimiter.mockReturnValue({ ok: true, retryAfterSec: 0 } as never);
});

describe("POST /api/mcp — the 429 names the scope that refused", () => {
  it("per-IP refusal states the scope, the limiter, and the budget the agent must fit", async () => {
    mockLimiter.mockReturnValue({
      ok: false,
      retryAfterSec: 9,
      scope: "ip",
      limiter: "gate",
      limit: 30,
      windowSec: 60,
      evaluated: true,
    } as never);

    const res = await post();

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("ip");
    expect(await res.json()).toMatchObject({ code: "rate_limited", scope: "ip", limiter: "gate", limit: 30, windowSec: 60 });
    // Charged before any token crypto — a throttled request never reaches token verification.
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("global refusal names the scope and withholds the fleet ceiling", async () => {
    mockLimiter.mockReturnValue({
      ok: false,
      retryAfterSec: 4,
      scope: "global",
      limiter: "gate",
      evaluated: true,
    } as never);

    const res = await post();
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("global");
    expect(body).toMatchObject({ code: "rate_limited", scope: "global" });
    // An agent door is the easiest surface to poll in a loop; disclosing the fleet budget or its
    // headroom here would hand a caller a live capacity meter.
    expect(body.limit).toBeUndefined();
    expect(body.windowSec).toBeUndefined();
    expect(res.headers.get("x-ascent-ratelimit-limit")).toBeNull();
  });

  it("does not refuse a request under the budget", async () => {
    const res = await post();
    expect(res.status).not.toBe(429);
  });
});
