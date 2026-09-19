// Pins the Polar customer-portal guards: minting a session is an external state change, so this GET
// must refuse Polar-absent (503), speculative prefetches (204), cross-origin probes (403), non-owners
// (before any Polar call), and unknown orgs (uniform 404) — and only 303 to a portal URL the helper
// returned. Polar SDK / DB / auth are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => {
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
  polarCustomerPortalUrl: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  getOrgId: vi.fn(async () => "org_1"),
  isDbConfigured: vi.fn(() => true),
  isDbUnavailableError: vi.fn(() => false),
}));
vi.mock("@/lib/auth", () => {
  const isSameOrigin = vi.fn(() => true);
  return {
    isSameOrigin,
    requireSameOrigin: vi.fn((req: Request) =>
      isSameOrigin(req) ? null : Response.json({ error: "Cross-origin request rejected." }, { status: 403 }),
    ),
  };
});
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/site", () => ({ publicBaseUrl: vi.fn(() => "https://ascent.test") }));

import { GET } from "./route";
import { polarEnabled, polarCustomerPortalUrl } from "@/lib/polar";
import { getOrgId, isDbConfigured, isDbUnavailableError } from "@/lib/db";
import { isSameOrigin } from "@/lib/auth";
import { requireOrgRole } from "@/lib/authz";

const mockPolarEnabled = vi.mocked(polarEnabled);
const mockPortalUrl = vi.mocked(polarCustomerPortalUrl);
const mockGetOrgId = vi.mocked(getOrgId);
const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockIsDbUnavailable = vi.mocked(isDbUnavailableError);
const mockSameOrigin = vi.mocked(isSameOrigin);
const mockRequireRole = vi.mocked(requireOrgRole);

function req(query = "org=acme", headers: Record<string, string> = {}) {
  return new Request(`https://ascent.test/api/billing/portal?${query}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPolarEnabled.mockReturnValue(true);
  mockSameOrigin.mockReturnValue(true);
  mockRequireRole.mockResolvedValue(null);
  mockIsDbConfigured.mockReturnValue(true);
  mockIsDbUnavailable.mockReturnValue(false);
  mockGetOrgId.mockResolvedValue("org_1");
  mockPortalUrl.mockResolvedValue("https://polar.test/portal/sess");
});

describe("GET /api/billing/portal — owner Polar portal", () => {
  it("503 when Polar is not configured (free / self-host)", async () => {
    mockPolarEnabled.mockReturnValue(false);
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(mockPortalUrl).not.toHaveBeenCalled();
  });

  it("204 (no session) on a speculative prefetch", async () => {
    const res = await GET(req("org=acme", { "sec-purpose": "prefetch;prerender" }));
    expect(res.status).toBe(204);
    expect(mockRequireRole).not.toHaveBeenCalled();
    expect(mockPortalUrl).not.toHaveBeenCalled();
  });

  it("403 on a cross-origin request, before any Polar call", async () => {
    mockSameOrigin.mockReturnValue(false);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockRequireRole).not.toHaveBeenCalled();
    expect(mockPortalUrl).not.toHaveBeenCalled();
  });

  it("is owner-gated — a non-owner's denial short-circuits before any Polar mint", async () => {
    const denial = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    mockRequireRole.mockResolvedValue(denial as never);
    const res = await GET(req("org=Acme"));
    expect(res).toBe(denial);
    expect(mockRequireRole).toHaveBeenCalledWith("acme", "owner");
    expect(mockGetOrgId).not.toHaveBeenCalled();
    expect(mockPortalUrl).not.toHaveBeenCalled();
  });

  it("400 when the org is missing", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Missing org." });
  });

  it("404 with a UNIFORM message for an unknown org (no slug echo)", async () => {
    mockGetOrgId.mockResolvedValue(null);
    const res = await GET(req("org=ghost"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).not.toContain("ghost");
    expect(mockPortalUrl).not.toHaveBeenCalled();
  });

  it("503 (retryable) when the org lookup fails on an unavailable DB", async () => {
    mockGetOrgId.mockRejectedValue(new Error("Can't reach database server at `localhost:5432`"));
    mockIsDbUnavailable.mockReturnValue(true);
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(mockPortalUrl).not.toHaveBeenCalled();
  });

  it("303-redirects to the Polar portal URL, binding the org as externalCustomerId", async () => {
    const res = await GET(req("org=Acme"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://polar.test/portal/sess");
    expect(mockPortalUrl).toHaveBeenCalledWith("acme", { returnUrl: "https://ascent.test/org/acme" });
    expect(mockRequireRole).toHaveBeenCalledWith("acme", "owner");
  });

  it("503 when Polar is present but no portal URL can be minted (no session, no hosted slug)", async () => {
    mockPortalUrl.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
  });
});
