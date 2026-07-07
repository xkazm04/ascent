// Pins the money-in checkout guards: a Polar checkout session is an external, billable state change, so
// this "safe" GET must refuse speculative prefetches (204), cross-origin probes (403), unknown products
// (400), and unknown orgs (uniform 404, no existence oracle) — and only ever mint a session for a real,
// priced product owned by a real org, carrying the org in BOTH externalCustomerId + metadata. The Polar
// SDK / DB / auth boundaries are mocked; the redirect + status codes are what's asserted.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => {
  // NextResponse used both as `new NextResponse(null, { status })` (the 204) and via static json/redirect.
  const NextResponse: unknown = function (body: unknown, init?: { status?: number }) {
    return new Response(body as BodyInit | null, init);
  };
  (NextResponse as { json: unknown }).json = (body: unknown, init?: { status?: number }) =>
    new Response(JSON.stringify(body), init);
  (NextResponse as { redirect: unknown }).redirect = (url: string, status?: number) =>
    new Response(null, { status: status ?? 307, headers: { location: url } });
  return { NextResponse };
});
vi.mock("@/lib/polar", () => ({
  polarEnabled: vi.fn(() => true),
  getPolar: vi.fn(),
  creditsForProduct: vi.fn(() => 100),
  planForProduct: vi.fn(() => null),
}));
vi.mock("@/lib/db", () => ({
  getOrgId: vi.fn(async () => "org_1"),
  isDbConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/auth", () => ({ isSameOrigin: vi.fn(() => true) }));
vi.mock("@/lib/site", () => ({ publicBaseUrl: vi.fn(() => "https://ascent.test") }));

import { GET } from "./route";
import { polarEnabled, getPolar, creditsForProduct, planForProduct } from "@/lib/polar";
import { getOrgId, isDbConfigured } from "@/lib/db";
import { isSameOrigin } from "@/lib/auth";

const mockPolarEnabled = vi.mocked(polarEnabled);
const mockGetPolar = vi.mocked(getPolar);
const mockCredits = vi.mocked(creditsForProduct);
const mockPlan = vi.mocked(planForProduct);
const mockGetOrgId = vi.mocked(getOrgId);
const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockSameOrigin = vi.mocked(isSameOrigin);

const create = vi.fn(async () => ({ url: "https://polar.test/checkout/abc" }));

function req(query = "org=acme&pack=prod_1", headers: Record<string, string> = {}) {
  return new Request(`https://ascent.test/api/billing/checkout?${query}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPolarEnabled.mockReturnValue(true);
  mockSameOrigin.mockReturnValue(true);
  mockCredits.mockReturnValue(100);
  mockPlan.mockReturnValue(null);
  mockIsDbConfigured.mockReturnValue(true);
  mockGetOrgId.mockResolvedValue("org_1");
  create.mockResolvedValue({ url: "https://polar.test/checkout/abc" });
  mockGetPolar.mockReturnValue({ checkouts: { create } } as unknown as ReturnType<typeof getPolar>);
});

describe("GET /api/billing/checkout — money-in guards", () => {
  it("503 when billing (Polar) is not configured", async () => {
    mockPolarEnabled.mockReturnValue(false);
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });

  it("204 (no session) on a speculative prefetch — never mints a billable session", async () => {
    const res = await GET(req("org=acme&pack=prod_1", { "sec-purpose": "prefetch;prerender" }));
    expect(res.status).toBe(204);
    expect(create).not.toHaveBeenCalled();
  });

  it("403 on a cross-origin request, before any DB read or Polar call", async () => {
    mockSameOrigin.mockReturnValue(false);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockGetOrgId).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("400 when the org is missing", async () => {
    const res = await GET(req("pack=prod_1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Missing org." });
  });

  it("400 for an unknown/forged product (not a credit pack nor a plan tier)", async () => {
    mockCredits.mockReturnValue(0);
    mockPlan.mockReturnValue(null);
    const res = await GET(req("org=acme&pack=forged"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Unknown product." });
    expect(create).not.toHaveBeenCalled();
  });

  it("404 with a UNIFORM message for an unknown org (no existence oracle, no slug echo)", async () => {
    mockGetOrgId.mockResolvedValue(null);
    const res = await GET(req("org=ghost&pack=prod_1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).not.toContain("ghost"); // must not echo the slug back
    expect(create).not.toHaveBeenCalled();
  });

  it("303-redirects to the Polar session, binding the org via externalCustomerId AND metadata", async () => {
    const res = await GET(req("org=Acme&pack=prod_1"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://polar.test/checkout/abc");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ products: ["prod_1"], externalCustomerId: "acme", metadata: { org: "acme" } }),
    );
    // The org is lowercased before the ownership check, too.
    expect(mockGetOrgId).toHaveBeenCalledWith("acme");
  });

  it("accepts a plan-tier product (credits 0 but a plan mapping) and mints the session", async () => {
    mockCredits.mockReturnValue(0);
    mockPlan.mockReturnValue("pro");
    const res = await GET(req("org=acme&pack=plan_pro"));
    expect(res.status).toBe(303);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ products: ["plan_pro"] }));
  });

  it("303-redirects to the org error URL when the Polar session creation fails (no crash)", async () => {
    create.mockRejectedValue(new Error("polar down"));
    const res = await GET(req());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("credits=error");
  });
});
