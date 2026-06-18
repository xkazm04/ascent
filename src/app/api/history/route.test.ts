// Security/authorization test for GET /api/history — the org-scoping gate that keeps a guessable
// owner/repo slug from leaking ANOTHER tenant's private scan history (route.ts:72-91).
//
// The invariant under test: org A's history is reachable ONLY through org A's resolved slug. The
// route's two guards are (a) the auth gate — when auth is configured and there is no session, return
// 401 and NEVER touch the DB; and (b) org-scoping — the `orgSlug` from `readableOrgForOwner(owner)`
// MUST flow unchanged into `getRepositoryHistory(owner, repo, { orgSlug })`, so a name collision can't
// cross tenants. We mock the auth + db boundaries so we can assert exactly which orgSlug reaches the
// query, and that an unauthenticated (auth-on) caller is denied before any read.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  // Extends the real Response so `new NextResponse(body, init)` (the CSV / 304 paths) works as a real
  // Response, and the static `.json()` helper mirrors NextResponse.json for the JSON path.
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
  isAuthConfigured: vi.fn(),
  readableOrgForOwner: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(),
  getRepositoryHistory: vi.fn(),
}));

import { GET } from "./route";
import { getSession, isAuthConfigured, readableOrgForOwner } from "@/lib/auth";
import { isDbConfigured, getRepositoryHistory } from "@/lib/db";

const mockGetSession = vi.mocked(getSession);
const mockIsAuthConfigured = vi.mocked(isAuthConfigured);
const mockReadableOrg = vi.mocked(readableOrgForOwner);
const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockGetHistory = vi.mocked(getRepositoryHistory);

function get(query: string, headers?: Record<string, string>) {
  return GET(new Request(`http://localhost/api/history${query}`, { headers }));
}

const historyFor = (owner: string, name: string) =>
  ({
    repo: { owner, name, fullName: `${owner}/${name}` },
    scans: [{ id: "s1", scannedAt: "2026-01-01T00:00:00.000Z", overallScore: 80 }],
  }) as unknown as Awaited<ReturnType<typeof getRepositoryHistory>>;

describe("GET /api/history — org-scoping & auth gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true);
    // Default: auth ON, signed in. Org resolution is overridden per-test.
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue({} as Awaited<ReturnType<typeof getSession>>);
    mockReadableOrg.mockResolvedValue("public");
    mockGetHistory.mockResolvedValue(null);
  });

  // --- Guard (a): auth gate fires BEFORE any DB read ---------------------------------------------

  it("denies (401) when auth is configured and there is no session, and never reads history", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(null);

    const res = await get("?repo=acme/secret");

    expect(res.status).toBe(401);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it("skips the auth gate when auth is NOT configured (local/demo) and still serves", async () => {
    mockIsAuthConfigured.mockReturnValue(false);
    mockGetSession.mockResolvedValue(null);
    mockReadableOrg.mockResolvedValue("public");
    mockGetHistory.mockResolvedValue(historyFor("acme", "repo"));

    const res = await get("?repo=acme/repo");

    expect(res.status).toBe(200);
    expect(mockGetSession).not.toHaveBeenCalled(); // short-circuited: auth-off skips the session check
  });

  // --- Guard (b): the resolved orgSlug flows INTO the query (the leak-prevention invariant) -------

  it("scopes the query to the caller's OWN org slug from readableOrgForOwner", async () => {
    mockReadableOrg.mockResolvedValue("acme"); // caller is a member of acme
    mockGetHistory.mockResolvedValue(historyFor("acme", "repo"));

    const res = await get("?repo=acme/repo");

    expect(res.status).toBe(200);
    expect(mockReadableOrg).toHaveBeenCalledWith("acme");
    // The org slug the auth layer resolved MUST be the one the DB query is scoped by.
    expect(mockGetHistory).toHaveBeenCalledWith(
      "acme",
      "repo",
      expect.objectContaining({ orgSlug: "acme" }),
    );
  });

  it("scopes a foreign/private slug to 'public' so a name collision can't leak another tenant", async () => {
    // Caller is NOT a member of 'acme' → readableOrgForOwner downgrades them to the public org.
    mockReadableOrg.mockResolvedValue("public");
    mockGetHistory.mockResolvedValue(null); // no public repo by that name → empty payload

    const res = await get("?repo=acme/private-repo");
    const body = await res.json();

    expect(res.status).toBe(200);
    // The query must be scoped to 'public', NEVER to the private 'acme' org the caller can't read.
    expect(mockGetHistory).toHaveBeenCalledWith(
      "acme",
      "private-repo",
      expect.objectContaining({ orgSlug: "public" }),
    );
    // No private rows leak: a miss yields an empty scans array, not acme's history.
    expect(body.scans).toEqual([]);
    // Critically, the DB was never queried with the private org slug.
    expect(mockGetHistory).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ orgSlug: "acme" }),
    );
  });

  it("scopes the CSV export with the same resolved org slug (no cross-tenant export)", async () => {
    mockReadableOrg.mockResolvedValue("public");
    mockGetHistory.mockResolvedValue(null);

    const res = await get("?repo=acme/private-repo&format=csv");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(mockGetHistory).toHaveBeenCalledWith(
      "acme",
      "private-repo",
      expect.objectContaining({ orgSlug: "public" }),
    );
  });

  // --- Precondition guards (cheap, also pinned by the finding) -----------------------------------

  it("returns 400 on missing repo and never reads history", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it("returns 400 on an invalid repo reference and never reads history", async () => {
    const res = await get("?repo=" + encodeURIComponent("https://gitlab.com/a/b"));
    expect(res.status).toBe(400);
    expect(mockGetHistory).not.toHaveBeenCalled();
  });

  it("returns 503 when the DB is not configured, before resolving any org", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await get("?repo=acme/repo");
    expect(res.status).toBe(503);
    expect(mockReadableOrg).not.toHaveBeenCalled();
    expect(mockGetHistory).not.toHaveBeenCalled();
  });
});
