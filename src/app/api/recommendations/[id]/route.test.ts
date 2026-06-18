// Tenant-gate test for PATCH /api/recommendations/:id (roadmap-recommendation-tracking #2, Critical).
// Pins the cross-tenant IDOR + public-funnel poisoning invariants documented in route.ts:35-48:
// the authorization decision keys on the org that OWNS the recommendation (resolved from the row via
// getRecommendationOrgSlug), NOT on "is signed in" and NOT on any client-supplied value. The route's
// db / auth / authz boundaries are mocked so we can assert EXACTLY when updateRecommendation fires.
//
// Order the gate must hold (all before any mutation): 404 on unknown id → 403 on PUBLIC_ORG →
// whatever requireOrgAccess(org) denies → only then updateRecommendation(id, patch, ...).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

// @/lib/db is a barrel; mock only the symbols the route imports. isDbConfigured defaults true so the
// 503 short-circuit doesn't pre-empt the gate. getRecommendationOrgSlug resolves the OWNING org.
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  getRecommendationOrgSlug: vi.fn(),
  updateRecommendation: vi.fn(),
}));

// PUBLIC_ORG is the literal "public" the route lower-cases the org against. getSession/isAuthConfigured
// only attribute the actor — neutral defaults keep them out of the way of the gate assertions.
vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  isAuthConfigured: vi.fn(() => false),
  getSession: vi.fn(async () => null),
}));

// requireOrgAccess is THE tenant gate: returns a denial Response to block, or null to allow.
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn() }));

import { PATCH } from "./route";
import { isDbConfigured, getRecommendationOrgSlug, updateRecommendation } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";

const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockOrgSlug = vi.mocked(getRecommendationOrgSlug);
const mockUpdate = vi.mocked(updateRecommendation);
const mockRequireOrgAccess = vi.mocked(requireOrgAccess);

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/recommendations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  // Default: the row belongs to a real, owned org and the gate ALLOWS — individual tests narrow this.
  mockOrgSlug.mockResolvedValue("acme" as never);
  mockRequireOrgAccess.mockResolvedValue(null);
  mockUpdate.mockResolvedValue({ id: "rec_1", status: "done" } as never);
});

describe("PATCH /api/recommendations/:id — tenant gate (cross-tenant IDOR + public poisoning)", () => {
  it("503s and never resolves the owning org when the DB is not configured", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await patch("rec_1", { status: "done" });
    expect(res.status).toBe(503);
    expect(mockOrgSlug).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("404s an unknown recommendation id and never writes (no leak that the id exists / no blind mutate)", async () => {
    mockOrgSlug.mockResolvedValue(null as never); // id not found → owning org unknown
    const res = await patch("rec_unknown", { status: "done" });
    expect(res.status).toBe(404);
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("403s a PUBLIC_ORG (public-funnel) recommendation and never mutates — poisoning blocked", async () => {
    mockOrgSlug.mockResolvedValue("public" as never);
    const res = await patch("rec_pub", { status: "done" });
    expect(res.status).toBe(403);
    expect(mockRequireOrgAccess).not.toHaveBeenCalled(); // gated before requireOrgAccess even runs
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("403s a PUBLIC_ORG slug regardless of casing/whitespace (e.g. ' Public ')", async () => {
    mockOrgSlug.mockResolvedValue("  Public  " as never);
    const res = await patch("rec_pub", { status: "done" });
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("CROSS-TENANT IDOR: gate keys on the row's true owning org, not a client-supplied org/value", async () => {
    // The caller targets rec_1, which truly belongs to "victim-org". The handler must authorize
    // against the RESOLVED owning org — even if the request body tries to smuggle an org claim, it is
    // ignored. requireOrgAccess denies (403), so NO update is written to the victim tenant.
    mockOrgSlug.mockResolvedValue("victim-org" as never);
    const denial = new Response(JSON.stringify({ error: "no access" }), { status: 403 });
    mockRequireOrgAccess.mockResolvedValue(denial as never);
    const res = await patch("rec_1", { status: "done", org: "attacker-org", orgSlug: "attacker-org" });
    expect(res.status).toBe(403);
    expect(res).toBe(denial); // the exact denial Response is returned verbatim
    // The gate was checked against the row's real org, never the body claim.
    expect(mockRequireOrgAccess).toHaveBeenCalledWith("victim-org");
    expect(mockUpdate).not.toHaveBeenCalled(); // no mutation written to another tenant's backlog
  });

  it("401 from requireOrgAccess (signed-out) is returned verbatim and nothing is written", async () => {
    const denial = new Response(JSON.stringify({ error: "Sign in" }), { status: 401 });
    mockRequireOrgAccess.mockResolvedValue(denial as never);
    const res = await patch("rec_1", { status: "done" });
    expect(res).toBe(denial);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("authorized in-org write succeeds and calls updateRecommendation with the parsed patch", async () => {
    const res = await patch("rec_1", { status: "in_progress" });
    expect(res.status).toBe(200);
    expect(mockRequireOrgAccess).toHaveBeenCalledWith("acme");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith("rec_1", { status: "in_progress" }, expect.anything());
  });

  it("maps a P2025 (row vanished between gate and write) to 404, not 500", async () => {
    mockUpdate.mockRejectedValue({ code: "P2025" } as never);
    const res = await patch("rec_1", { status: "done" });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/recommendations/:id — body validation gates run only after the tenant gate", () => {
  // These pin that an authorized caller still cannot store junk; equally important, every 400 below
  // proves the body is validated and updateRecommendation is NOT called with bad data.
  it("rejects an out-of-enum status with 400 and never writes", async () => {
    const res = await patch("rec_1", { status: "foo" });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects an empty patch ({}) with 400 — no no-op write", async () => {
    const res = await patch("rec_1", {});
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a malformed assigneeLogin (whitespace) with 400", async () => {
    const res = await patch("rec_1", { assigneeLogin: "has space" });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-YYYY-MM-DD targetDate with 400 (contract enforced at the boundary)", async () => {
    const res = await patch("rec_1", { targetDate: "2026/06/09" });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a calendar-invalid targetDate (2026-13-45) with 400", async () => {
    const res = await patch("rec_1", { targetDate: "2026-13-45" });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("accepts assigneeLogin:null and targetDate:null (clears) for an authorized caller", async () => {
    const res = await patch("rec_1", { assigneeLogin: null, targetDate: null });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      "rec_1",
      { assigneeLogin: null, targetDate: null },
      expect.anything(),
    );
  });

  it("accepts a valid YYYY-MM-DD targetDate for an authorized caller", async () => {
    const res = await patch("rec_1", { targetDate: "2026-06-09" });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith("rec_1", { targetDate: "2026-06-09" }, expect.anything());
  });
});
