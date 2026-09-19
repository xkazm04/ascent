// Pins the credit-grant endpoint's authorization + mint guards (credits-entitlements #4). This is the
// only self-serve path that can add credits; its own comment warns that exposing it would "let an owner
// mint free scans." The route composes five independent guards before it is allowed to call grantCredits:
//   1. creditGrantsEnabled() — ASCENT_ALLOW_CREDIT_GRANTS set AND NODE_ENV !== "production"
//   2. isSameOrigin(req)     — CSRF defense on this money-adjacent mutation
//   3. requireOrgRole owner  — only the org owner may change its balance
//   4. amount clamp          — non-zero integer, |amount| <= 100_000 (bounds ONE call)
//   5. lifetime cap          — net manual grants so far + amount <= 1_000_000 (bounds ALL calls)
// Invariant: grantCredits is invoked IFF all five guards pass; on the happy path it is called exactly
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
  getCreditState: vi.fn(async () => ({ balance: 42, plan: "free", unlimited: false, orgExists: true })),
  grantCredits: vi.fn(async () => 142),
  isDbConfigured: () => true,
}));
// The route reads the org's already-minted total straight from the credits submodule (the db barrel
// re-exports by name; entitlement.ts imports the submodule the same way), so mock it separately.
vi.mock("@/lib/db/credits", () => ({ sumManualGrants: vi.fn(async () => 0) }));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => {
  const isSameOrigin = vi.fn(() => true);
  return {
    getSession: vi.fn(async () => ({ login: "owner-login" })),
    isSameOrigin,
    requireSameOrigin: vi.fn((req: Request) =>
      isSameOrigin(req) ? null : Response.json({ error: "Cross-origin request rejected." }, { status: 403 }),
    ),
  };
});

import { POST } from "./route";
import { getCreditState, grantCredits } from "@/lib/db";
import { sumManualGrants } from "@/lib/db/credits";
import { requireOrgRole } from "@/lib/authz";
import { isSameOrigin } from "@/lib/auth";

const mockGrant = vi.mocked(grantCredits);
const mockManualTotal = vi.mocked(sumManualGrants);
const mockState = vi.mocked(getCreditState);
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
  vi.stubEnv("NODE_ENV", "test");
  mockManualTotal.mockResolvedValue(0);
  mockSameOrigin.mockReturnValue(true);
  mockRequireRole.mockResolvedValue(null);
  mockGrant.mockResolvedValue(142);
  mockState.mockResolvedValue({ balance: 42, plan: "free", unlimited: false, orgExists: true });
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

  it("(a) rejects with 403 and NEVER mints in production EVEN WITH the env flag set true", async () => {
    // The production hard-disable, mirroring authBypassEnabled: a leaked / misconfigured / reused
    // ASCENT_ALLOW_CREDIT_GRANTS must not be able to open a credit mint on a real deployment. Every
    // other guard here is satisfied — owner, same-origin, in-clamp amount — so NODE_ENV is the only
    // thing standing between the caller and free scans.
    vi.stubEnv("ASCENT_ALLOW_CREDIT_GRANTS", "true");
    vi.stubEnv("NODE_ENV", "production");
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

  it("(e) blocks the (N+1)th grant that would push the org past the lifetime cap", async () => {
    // Ten in-clamp calls of 100_000 exhaust the 1_000_000 lifetime cap; the eleventh must be refused
    // even though each individual call is perfectly legal under the per-call clamp. This is the whole
    // point of the cumulative bound: the per-call clamp bounds ONE call, not their sum.
    mockManualTotal.mockResolvedValue(1_000_000);
    const res = await POST(req({ org: "acme", amount: 1 }));
    expect(res.status).toBe(403);
    expect(mockGrant).not.toHaveBeenCalled();
    const json = (await res.json()) as { error: string; granted: number; cap: number };
    expect(json.granted).toBe(1_000_000);
    expect(json.cap).toBe(1_000_000);
  });

  it("(e) blocks a grant that would only PARTLY exceed the cap — no partial mint up to the ceiling", async () => {
    mockManualTotal.mockResolvedValue(950_000);
    const res = await POST(req({ org: "acme", amount: 100_000 }));
    expect(res.status).toBe(403);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it("(e) allows the grant that lands EXACTLY on the cap (the bound is inclusive)", async () => {
    mockManualTotal.mockResolvedValue(900_000);
    const res = await POST(req({ org: "acme", amount: 100_000 }));
    expect(res.status).toBe(200);
    expect(mockGrant).toHaveBeenCalledTimes(1);
  });

  it("(e) the lifetime cap never blocks a DEBIT — a correction can always give headroom back", async () => {
    // sumManualGrants is NET, so the -50 below is what restores headroom after a mistaken grant. If the
    // cap gated debits too, an org that hit the ceiling could never be reconciled downward again.
    mockManualTotal.mockResolvedValue(1_000_000);
    const res = await POST(req({ org: "acme", amount: -50 }));
    expect(res.status).toBe(200);
    expect(mockGrant).toHaveBeenCalledWith("acme", -50, { reason: "adjustment", actor: "owner-login" });
  });

  it("(e) reads the cap basis from the persisted ledger for the requested org, not from the balance", async () => {
    // Spending granted credits must not buy fresh headroom, so the basis is the ledger total — asserted
    // by the call shape (the org slug) rather than any balance the state mock reports.
    mockState.mockResolvedValue({ balance: 0, plan: "free", unlimited: false, orgExists: true });
    await POST(req({ org: "acme", amount: 100 }));
    expect(mockManualTotal).toHaveBeenCalledWith("acme");
  });

  it("(e) happy path: all guards pass → mints exactly once with actor = session login", async () => {
    const res = await POST(req({ org: "acme", amount: 100 }));
    expect(res.status).toBe(200);
    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockGrant).toHaveBeenCalledWith("acme", 100, {
      reason: "grant",
      actor: "owner-login",
    });
    // appliedDelta = balance after (142) − balance before (42): the full +100 landed.
    const json = (await res.json()) as { ok: boolean; balance: number; appliedDelta: number };
    expect(json).toEqual({ ok: true, balance: 142, appliedDelta: 100 });
  });

  it("surfaces a CLAMPED debit honestly: -500 against a balance of 30 reports appliedDelta -30", async () => {
    // grantCredits clamps a debit to the available balance (ledger honesty); the HTTP contract must
    // not report bare success — the operator reconciling books needs the delta that ACTUALLY applied.
    mockState.mockResolvedValue({ balance: 30, plan: "free", unlimited: false, orgExists: true });
    mockGrant.mockResolvedValue(0);
    const res = await POST(req({ org: "acme", amount: -500 }));
    expect(await res.json()).toEqual({ ok: true, balance: 0, appliedDelta: -30 });
  });

  it("reports appliedDelta 0 for a debit against an already-empty balance (nothing was removed)", async () => {
    mockState.mockResolvedValue({ balance: 0, plan: "free", unlimited: false, orgExists: true });
    mockGrant.mockResolvedValue(0);
    const res = await POST(req({ org: "acme", amount: -500 }));
    expect(await res.json()).toEqual({ ok: true, balance: 0, appliedDelta: 0 });
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
