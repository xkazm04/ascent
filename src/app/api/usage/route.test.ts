// Integration test for the /api/usage cross-tenant authorization gate (IDOR).
// usage/route.ts:56-77 must enforce the same org scoping the /usage page does: a caller may
// only read the "public" org or an org their session installations include. The INVARIANT we
// pin is behavioral, not implementational — every denial path returns the right status AND the
// usage reader (getUsageSummary) is never invoked, so no tenant's volume/timeline/repo names are
// ever computed on a rejected request; an authorized own-org caller gets the data. The gate must
// run BEFORE the read. The auth/db boundaries are mocked so we can assert exactly when the reader
// fires. Mirrors the in-house route-integration pattern in src/app/api/scan/route.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(), isAuthConfigured: vi.fn() }));
vi.mock("@/lib/db", () => ({ getUsageSummary: vi.fn(), isDbConfigured: vi.fn() }));

import { GET } from "./route";
import { getSession, isAuthConfigured } from "@/lib/auth";
import { getUsageSummary, isDbConfigured } from "@/lib/db";

const mockGetSession = vi.mocked(getSession);
const mockIsAuthConfigured = vi.mocked(isAuthConfigured);
const mockGetUsageSummary = vi.mocked(getUsageSummary);
const mockIsDbConfigured = vi.mocked(isDbConfigured);

function get(query: string) {
  return GET(new Request(`http://localhost/api/usage${query}`));
}

// A minimal UsageSummary-shaped object; the gate doesn't inspect its contents.
const SUMMARY = { daily: [] } as unknown as Awaited<ReturnType<typeof getUsageSummary>>;

// A session whose installations include `logins` (case is normalized in the route).
const sessionWith = (...logins: string[]) =>
  ({ installations: logins.map((login) => ({ login })) }) as unknown as Awaited<
    ReturnType<typeof getSession>
  >;

describe("GET /api/usage — cross-tenant authorization gate (IDOR) (#2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true); // DB on, so we reach the authz gate (not the 503)
    mockGetUsageSummary.mockResolvedValue(SUMMARY);
  });

  it("DENIES a private org when auth is not configured (403) and never reads usage", async () => {
    mockIsAuthConfigured.mockReturnValue(false);

    const res = await get("?org=acme");

    expect(res.status).toBe(403);
    expect(mockGetUsageSummary).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("DENIES an unauthenticated caller of a private org (401) and never reads usage", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(null);

    const res = await get("?org=acme");

    expect(res.status).toBe(401);
    expect(mockGetUsageSummary).not.toHaveBeenCalled();
  });

  it("DENIES a non-member requesting another org's usage (403) and never reads usage", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(sessionWith("my-own-org"));

    const res = await get("?org=acme"); // caller is NOT a member of acme

    expect(res.status).toBe(403);
    expect(mockGetUsageSummary).not.toHaveBeenCalled();
  });

  it("ALLOWS a member requesting their own org's usage (200) and reads the data once", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(sessionWith("Acme")); // membership is case-insensitive

    const res = await get("?org=acme");

    expect(res.status).toBe(200);
    expect(mockGetUsageSummary).toHaveBeenCalledTimes(1);
    expect(mockGetUsageSummary).toHaveBeenCalledWith("acme", expect.any(Number));
  });

  it("ALLOWS the shared public org without a session (200)", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(null);

    const res = await get("?org=public");

    expect(res.status).toBe(200);
    expect(mockGetSession).not.toHaveBeenCalled(); // public org short-circuits before the session check
    expect(mockGetUsageSummary).toHaveBeenCalledTimes(1);
  });

  it("defaults to the public org (no ?org) and serves it without auth (200)", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(null);

    const res = await get("");

    expect(res.status).toBe(200);
    expect(mockGetUsageSummary).toHaveBeenCalledTimes(1);
  });
});
