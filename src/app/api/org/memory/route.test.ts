// Route test for /api/org/memory (Shared Org Memory). Pins the authorization chain and its ORDER — the
// invariants the route alone owns:
//   DB-configured -> body validation -> member gate -> Team+ plan gate -> kind/visibility validation -> write.
// A non-member is denied verbatim with NO write (the design doc §4 cross-tenant test, at the route
// seam); a non-Team plan is 403; a supersede aimed outside the org maps to 400, never a 500. GET is
// read-gated, forwards the validated sort, and passes the VIEWER down so private scratch stays private.
//
// next/server is faked as a Response subclass; authz + db + access are mocked; plans.ts runs REAL
// (driven by the mocked plan), so the Team+ gate is genuinely exercised rather than stubbed.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const {
  mockIsDbConfigured,
  mockListOrgMemories,
  mockListOrgMemoryNamespaces,
  mockCreateOrgMemory,
  mockGetCreditState,
  mockWorkspaceAllowsMemory,
  mockPersonalMemoryCapReached,
  mockGetOrgId,
  mockRecordAudit,
  mockRequireOrgAccess,
  mockRequireOrgRead,
  mockResolveViewerLogin,
  MockSupersedeError,
} = vi.hoisted(() => {
  // Mirrors the real class: the route branches on `instanceof`, so the test must reject with THIS one.
  class MockSupersedeError extends Error {}
  return {
    mockIsDbConfigured: vi.fn(),
    mockListOrgMemories: vi.fn(),
    mockListOrgMemoryNamespaces: vi.fn(),
    mockCreateOrgMemory: vi.fn(),
    mockGetCreditState: vi.fn(),
    mockWorkspaceAllowsMemory: vi.fn(),
    mockPersonalMemoryCapReached: vi.fn(),
    mockGetOrgId: vi.fn(),
    mockRecordAudit: vi.fn(),
    mockRequireOrgAccess: vi.fn(),
    mockRequireOrgRead: vi.fn(),
    mockResolveViewerLogin: vi.fn(),
    MockSupersedeError,
  };
});

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  listOrgMemories: mockListOrgMemories,
  listOrgMemoryNamespaces: mockListOrgMemoryNamespaces,
  createOrgMemory: mockCreateOrgMemory,
  getCreditState: mockGetCreditState,
  workspaceAllowsMemory: mockWorkspaceAllowsMemory,
  personalMemoryCapReached: mockPersonalMemoryCapReached,
  PERSONAL_MEMORY_LIMIT: 100,
  getOrgId: mockGetOrgId,
  recordAudit: mockRecordAudit,
  SupersedeTargetNotFoundError: MockSupersedeError,
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: mockRequireOrgAccess,
  requireOrgRead: mockRequireOrgRead,
}));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: mockResolveViewerLogin }));

import { GET, POST } from "./route";

const postReq = (body: unknown) =>
  new Request("http://t/api/org/memory", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const valid = { org: "acme", content: "We moved auth to Supabase OAuth." };

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockRequireOrgAccess.mockResolvedValue(null);
  mockRequireOrgRead.mockResolvedValue(null);
  mockGetCreditState.mockResolvedValue({ plan: "team", balance: 0, unlimited: false });
  mockWorkspaceAllowsMemory.mockResolvedValue(true);
  mockPersonalMemoryCapReached.mockResolvedValue(false);
  mockCreateOrgMemory.mockResolvedValue({ id: "mem_1" });
  mockListOrgMemories.mockResolvedValue([]);
  mockListOrgMemoryNamespaces.mockResolvedValue([]);
  mockGetOrgId.mockResolvedValue("org_acme");
  mockRecordAudit.mockResolvedValue(true);
  mockResolveViewerLogin.mockResolvedValue("alice");
});

describe("POST /api/org/memory — auth chain + order", () => {
  it("503 when the DB is not configured (before any gate)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await POST(postReq(valid));
    expect(res.status).toBe(503);
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
  });

  it("400 on missing required fields (before any gate)", async () => {
    const res = await POST(postReq({ org: "acme" }));
    expect(res.status).toBe(400);
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
  });

  it("400 on whitespace-only content", async () => {
    const res = await POST(postReq({ org: "acme", content: "   " }));
    expect(res.status).toBe(400);
  });

  it("denies a non-member VERBATIM and never writes (the cross-tenant guard)", async () => {
    mockRequireOrgAccess.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }));
    const res = await POST(postReq(valid));
    expect(res.status).toBe(403);
    expect(mockGetCreditState).not.toHaveBeenCalled();
    expect(mockCreateOrgMemory).not.toHaveBeenCalled();
  });

  it("403 on a non-Team plan (gate passed) and never writes", async () => {
    mockGetCreditState.mockResolvedValue({ plan: "free", balance: 0, unlimited: false });
    mockWorkspaceAllowsMemory.mockResolvedValue(false);
    const res = await POST(postReq(valid));
    expect(res.status).toBe(403);
    expect(mockCreateOrgMemory).not.toHaveBeenCalled();
  });

  it("400 on an invalid kind (after member + plan pass), no write", async () => {
    const res = await POST(postReq({ ...valid, kind: "bogus" }));
    expect(res.status).toBe(400);
    expect(mockRequireOrgAccess).toHaveBeenCalledWith("acme");
    expect(mockCreateOrgMemory).not.toHaveBeenCalled();
  });

  it("400 on an invalid visibility, no write", async () => {
    const res = await POST(postReq({ ...valid, visibility: "world" }));
    expect(res.status).toBe(400);
    expect(mockCreateOrgMemory).not.toHaveBeenCalled();
  });

  it("writes on the happy path, passing the author login and auditing", async () => {
    const res = await POST(postReq({ ...valid, kind: "procedural", supersedeId: "mem_old" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "mem_1" });
    expect(mockCreateOrgMemory).toHaveBeenCalledTimes(1);
    expect(mockCreateOrgMemory.mock.calls[0]![1]).toMatchObject({ kind: "procedural", supersedeId: "mem_old" });
    expect(mockCreateOrgMemory.mock.calls[0]![2]).toBe("alice");
    expect(mockRecordAudit).toHaveBeenCalledWith(
      "org_memory.created",
      expect.objectContaining({ memoryId: "mem_1", supersededId: "mem_old" }),
      expect.objectContaining({ actorId: "alice" }),
    );
  });

  it("maps a supersede target outside the org to 400 (not 500) — nothing was stored", async () => {
    mockCreateOrgMemory.mockRejectedValue(new MockSupersedeError("The memory to supersede was not found."));
    const res = await POST(postReq({ ...valid, supersedeId: "mem_from_other_org" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("supersede");
  });

  it("maps an unexpected db failure to 500", async () => {
    mockCreateOrgMemory.mockRejectedValue(new Error("boom"));
    const res = await POST(postReq(valid));
    expect(res.status).toBe(500);
  });

  it("500s when the db layer reports persistence off mid-flight (null)", async () => {
    mockCreateOrgMemory.mockResolvedValue(null);
    const res = await POST(postReq(valid));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/org/memory — read gate", () => {
  it("requires ?org", async () => {
    const res = await GET(new Request("http://t/api/org/memory"));
    expect(res.status).toBe(400);
  });

  it("denies an unauthorized reader verbatim and never queries", async () => {
    mockRequireOrgRead.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }));
    const res = await GET(new Request("http://t/api/org/memory?org=acme"));
    expect(res.status).toBe(403);
    expect(mockListOrgMemories).not.toHaveBeenCalled();
  });

  it("returns memories + the curated kind list + the org's namespaces", async () => {
    mockListOrgMemories.mockResolvedValue([{ id: "m1" }]);
    mockListOrgMemoryNamespaces.mockResolvedValue(["backend"]);
    const res = await GET(new Request("http://t/api/org/memory?org=acme&sort=confidence"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories).toEqual([{ id: "m1" }]);
    expect(body.kinds).toContain("procedural");
    expect(body.namespaces).toEqual(["backend"]);
  });

  it("forwards the validated sort and drops a bogus one", async () => {
    await GET(new Request("http://t/api/org/memory?org=acme&sort=confidence"));
    expect(mockListOrgMemories.mock.calls[0]![1]).toMatchObject({ sort: "confidence" });

    mockListOrgMemories.mockClear();
    await GET(new Request("http://t/api/org/memory?org=acme&sort=drop%20table"));
    expect(mockListOrgMemories.mock.calls[0]![1]!.sort).toBeUndefined();
  });

  it("passes the VIEWER down so another author's private scratch stays hidden", async () => {
    await GET(new Request("http://t/api/org/memory?org=acme"));
    expect(mockListOrgMemories.mock.calls[0]![2]).toBe("alice");
  });

  it("forwards the namespace + kind + search filters", async () => {
    await GET(new Request("http://t/api/org/memory?org=acme&namespace=backend&kind=episodic&search=oauth"));
    expect(mockListOrgMemories.mock.calls[0]![1]).toMatchObject({
      namespace: "backend",
      kind: "episodic",
      search: "oauth",
    });
  });
});
