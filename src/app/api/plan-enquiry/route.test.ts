// POST /api/plan-enquiry — the rate-limit refusal on the Custom-tier contact form.
//
// This is the only door a Custom-tier lead has, and it is answered to a HUMAN staring at a form.
// "Rate limit exceeded, try again shortly" is the same sentence whether that person submitted three
// times in a minute (their own budget: the message says which budget and how wide the window is) or
// the shared contact budget was spent by a spam wave they have nothing to do with (slowing down
// need not clear it). The route now passes the whole RateLimitResult so the two read differently.
//
// The REAL `tooManyRequests` is used here — the body and headers are the behaviour under test.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init),
  },
}));
// Same-origin is the OUTER guard; allow it so these tests reach the limiter behind it.
vi.mock("@/lib/auth", () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/access", () => ({ getViewer: vi.fn(async () => null) }));
// Storage / mail boundaries: never reached on a throttled request, stubbed to keep their module
// graphs (DB driver, mailer) out of this test — and asserted un-called below.
vi.mock("@/lib/db", () => ({ isDbConfigured: () => false, listOrgsForLogin: vi.fn(async () => []) }));
vi.mock("@/lib/db/plan-enquiry", () => ({
  createPlanEnquiry: vi.fn(async () => null),
  recordPlanEnquiryEmail: vi.fn(async () => {}),
}));
vi.mock("@/lib/email/plan-enquiry", () => ({ dispatchPlanEnquiryEmail: vi.fn(async () => ({ sent: false })) }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    rateLimitRequestShared: vi.fn(async () => ({ ok: true, retryAfterSec: 0 })),
    tooManyRequests: actual.tooManyRequests,
    CONTACT_RATE_LIMIT: {},
  };
});

import { POST } from "./route";
import { rateLimitRequestShared } from "@/lib/rate-limit";
import { createPlanEnquiry } from "@/lib/db/plan-enquiry";
import { dispatchPlanEnquiryEmail } from "@/lib/email/plan-enquiry";

const mockLimiter = vi.mocked(rateLimitRequestShared);
const mockCreate = vi.mocked(createPlanEnquiry);
const mockMail = vi.mocked(dispatchPlanEnquiryEmail);

function post() {
  return POST(
    new Request("http://localhost/api/plan-enquiry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dana", email: "dana@example.com", message: "We need Custom." }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLimiter.mockResolvedValue({ ok: true, retryAfterSec: 0 } as never);
});

describe("POST /api/plan-enquiry — the 429 names the scope that refused", () => {
  it("per-IP refusal states the scope and the budget the submitter exceeded", async () => {
    mockLimiter.mockResolvedValue({
      ok: false,
      retryAfterSec: 45,
      scope: "ip",
      limiter: "contact",
      limit: 3,
      windowSec: 3600,
      evaluated: true,
    } as never);

    const res = await post();

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("45");
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("ip");
    expect(await res.json()).toMatchObject({ code: "rate_limited", scope: "ip", limiter: "contact", limit: 3, windowSec: 3600 });
    // A throttled submission is neither stored nor mailed — the whole reason this gate exists.
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockMail).not.toHaveBeenCalled();
  });

  it("global refusal names the scope without disclosing the fleet ceiling", async () => {
    mockLimiter.mockResolvedValue({
      ok: false,
      retryAfterSec: 11,
      scope: "global",
      limiter: "contact",
      evaluated: true,
    } as never);

    const res = await post();
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("global");
    expect(body).toMatchObject({ code: "rate_limited", scope: "global" });
    // An unauthenticated public form must not report how much fleet-wide contact budget remains.
    expect(body.limit).toBeUndefined();
    expect(body.windowSec).toBeUndefined();
    expect(res.headers.get("x-ascent-ratelimit-limit")).toBeNull();
  });

  it("an unevaluated refusal says the limiter could not run, not that the submitter overspent", async () => {
    mockLimiter.mockResolvedValue({
      ok: false,
      retryAfterSec: 5,
      scope: "unavailable",
      limiter: "contact",
      evaluated: false,
    } as never);

    const res = await post();

    expect(res.status).toBe(429);
    expect(res.headers.get("x-ascent-ratelimit-scope")).toBe("unavailable");
    expect(await res.json()).toMatchObject({ code: "rate_limit_unavailable", scope: "unavailable", evaluated: false });
  });

  it("a request under the budget is not refused", async () => {
    const res = await post();
    expect(res.status).not.toBe(429);
  });
});
