// Pins the credit-grant endpoint's authorization + mint guards (credits-entitlements #4). This is the
// only self-serve path that can add credits; its own comment warns that exposing it would "let an owner
// mint free scans." The route composes four independent guards before it is allowed to call grantCredits:
//   1. grantsEnabled()      — ASCENT_ALLOW_CREDIT_GRANTS must be set (production guard)
//   2. isSameOrigin(req)    — CSRF defense on this money-adjacent mutation
//   3. requireOrgRole owner — only the org owner may change its balance
//   4. amount clamp         — non-zero integer, |amount| <= 100_000
// Invariant: grantCredits is invoked IFF all four guards pass; on the happy path it is called exactly
// once with actor = the session login. A redelivery delegates to the idempotent db fn (asserted via the
// externalId-less call shape the route uses — it never tries to dedupe at the route level itself).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  grantCredits: vi.fn(async () => 142),
  isDbConfigured: () => true,
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => ({ login: "owner-login" })),
  isSameOrigin: vi.fn(() => true),
}));

import { POST } from "./route";
import { grantCredits } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { isSameOrigin } from "@/lib/auth";

const mockGrant = vi.mocked(grantCredits);
const mockRequireRole = vi.mocked(requireOrgRole);
const mockSameOrigin = vi.mocked(isSameOrigin);

function req(body: unknown = { org: "acme", amount: 100 }) {
  return new Request("http://localhost/api/org/credits/grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: every guard passes. Each test flips exactly one to prove it gates grantCredits.
  vi.stubEnv("ASCENT_ALLOW_CREDIT_GRANTS", "1");
  mockSameOrigin.mockReturnValue(true);
  mockRequireRole.mockResolvedValue(null);
  mockGrant.mockResolvedValue(142);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/org/credits/grant — authorization + mint guards", () => {
  it("(a) rejects with 403 and NEVER mints when ASCENT_ALLOW_CREDIT_GRANTS is unset", async () => {
    vi.stubEnv("ASCENT_ALLOW_CREDIT_GRANTS", "");
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("(b) rejects cross-origin with 403 and NEVER mints (CSRF guard)", async () => {
    mockSameOrigin.mockReturnValue(false);
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("(c) returns requireOrgRole's denial Response and NEVER mints (non-owner)", async () => {
    const denial = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    mockRequireRole.mockResolvedValue(denial as never);
    const res = await POST(req());
    expect(res).toBe(denial); // the exact denial Response is propagated
    expect(mockRequireRole).toHaveBeenCalledWith("acme", "owner");
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("(d) rejects amount:0 with 400 and NEVER mints", async () => {
    const res = await POST(req({ org: "acme", amount: 0 }));
    expect(res.status).toBe(400);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("(d) rejects amount over the 100000 clamp with 400 and NEVER mints", async () => {
    const res = await POST(req({ org: "acme", amount: 100001 }));
    expect(res.status).toBe(400);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("(d) rejects a non-numeric / missing amount with 400 and NEVER mints", async () => {
    const res = await POST(req({ org: "acme" }));
    expect(res.status).toBe(400);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("(e) happy path: all guards pass → mints exactly once with actor = session login", async () => {
    const res = await POST(req({ org: "acme", amount: 100 }));
    expect(res.status).toBe(200);
    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockGrant).toHaveBeenCalledWith("acme", 100, {
      reason: "grant",
      actor: "owner-login",
    });
    const json = (await res.json()) as { ok: boolean; balance: number };
    expect(json).toEqual({ ok: true, balance: 142 });
  });

  it("a negative amount mints once with reason 'adjustment' (owner debit/correction path)", async () => {
    const res = await POST(req({ org: "acme", amount: -50 }));
    expect(res.status).toBe(200);
    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockGrant).toHaveBeenCalledWith("acme", -50, {
      reason: "adjustment",
      actor: "owner-login",
    });
  });

  it("idempotency: the route never self-dedupes — it delegates to the idempotent db fn (no externalId in the call shape)", async () => {
    // Two identical authorized requests both reach grantCredits; the route does NOT short-circuit a
    // redelivery itself. Safety against double-grant therefore lives in grantCredits (externalId
    // fast-path), and the route must pass a call shape that carries no client-controlled dedupe key.
    await POST(req({ org: "acme", amount: 100 }));
    await POST(req({ org: "acme", amount: 100 }));
    expect(mockGrant).toHaveBeenCalledTimes(2);
    for (const call of mockGrant.mock.calls) {
      const opts = call[2] as { externalId?: string };
      expect(opts.externalId).toBeUndefined();
    }
  });

  it("returns 404 when grantCredits resolves null (unknown org) without throwing", async () => {
    mockGrant.mockResolvedValue(null);
    const res = await POST(req({ org: "ghost", amount: 100 }));
    expect(res.status).toBe(404);
    expect(mockGrant).toHaveBeenCalledTimes(1);
  });
});
