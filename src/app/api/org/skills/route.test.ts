// Route test for /api/org/skills (Org Skills Library, Feature 2). Pins the create-path authorization
// chain and its ORDER — the invariants the route alone owns:
//   DB-configured -> body validation -> member gate -> Team+ plan gate -> category validation ->
//   frontmatter contract -> create.
// A non-member is denied (gate verbatim, no write); a non-Team plan is 403 (no write); a duplicate name
// (P2002) maps to 409. GET is read-gated and returns the curated category list. next/server is faked as
// a Response subclass; authz + db + auth are mocked; plans.ts runs REAL (driven by the mocked plan).

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
  mockListOrgSkills,
  mockCreateOrgSkill,
  mockGetCreditState,
  mockWorkspaceAllowsSkills,
  mockPersonalSkillCapReached,
  mockAuthorizeOrgApi,
  mockPrincipalLogin,
} = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockListOrgSkills: vi.fn(),
  mockCreateOrgSkill: vi.fn(),
  mockGetCreditState: vi.fn(),
  mockWorkspaceAllowsSkills: vi.fn(),
  mockPersonalSkillCapReached: vi.fn(),
  mockAuthorizeOrgApi: vi.fn(),
  mockPrincipalLogin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  listOrgSkills: mockListOrgSkills,
  createOrgSkill: mockCreateOrgSkill,
  getCreditState: mockGetCreditState,
  workspaceAllowsSkills: mockWorkspaceAllowsSkills,
  personalSkillCapReached: mockPersonalSkillCapReached,
  PERSONAL_SKILL_LIMIT: 5,
}));
// isDenied is a pure type guard ("denied" in r) — kept real; only the network/identity calls are mocked.
vi.mock("@/lib/api-token-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-token-auth")>();
  return { ...actual, authorizeOrgApi: mockAuthorizeOrgApi, principalLogin: mockPrincipalLogin };
});

import { GET, POST } from "./route";

const postReq = (body: unknown) =>
  new Request("http://t/api/org/skills", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const valid = {
  org: "acme",
  name: "PR review",
  category: "workflow",
  content: "do the thing",
  description: "Review a PR.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockAuthorizeOrgApi.mockResolvedValue({ principal: { via: "session", login: "alice" } });
  mockPrincipalLogin.mockResolvedValue("alice");
  mockGetCreditState.mockResolvedValue({ plan: "team", balance: 0, unlimited: false });
  mockWorkspaceAllowsSkills.mockResolvedValue(true);
  mockPersonalSkillCapReached.mockResolvedValue(false);
  mockCreateOrgSkill.mockResolvedValue({ id: "skill_1" });
  mockListOrgSkills.mockResolvedValue([]);
});

describe("POST /api/org/skills — auth chain + order", () => {
  it("503 when the DB is not configured (before any gate)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await POST(postReq(valid));
    expect(res.status).toBe(503);
    expect(mockAuthorizeOrgApi).not.toHaveBeenCalled();
  });

  it("400 on missing required fields", async () => {
    const res = await POST(postReq({ org: "acme", name: "x" }));
    expect(res.status).toBe(400);
    expect(mockAuthorizeOrgApi).not.toHaveBeenCalled();
  });

  it("denies a non-member verbatim and never writes", async () => {
    mockAuthorizeOrgApi.mockResolvedValue({ denied: Response.json({ error: "no" }, { status: 403 }) });
    const res = await POST(postReq(valid));
    expect(res.status).toBe(403);
    expect(mockGetCreditState).not.toHaveBeenCalled();
    expect(mockCreateOrgSkill).not.toHaveBeenCalled();
  });

  it("403 on a non-Team plan (gate passed) and never writes", async () => {
    mockGetCreditState.mockResolvedValue({ plan: "free", balance: 0, unlimited: false });
    mockWorkspaceAllowsSkills.mockResolvedValue(false);
    const res = await POST(postReq(valid));
    expect(res.status).toBe(403);
    expect(mockCreateOrgSkill).not.toHaveBeenCalled();
  });

  it("400 on an invalid category (after member + plan pass), no write", async () => {
    const res = await POST(postReq({ ...valid, category: "bogus" }));
    expect(res.status).toBe(400);
    expect(mockAuthorizeOrgApi).toHaveBeenCalledWith(expect.anything(), "acme", { scope: "skills:write", mode: "write" });
    expect(mockCreateOrgSkill).not.toHaveBeenCalled();
  });

  it("creates on the happy path (passes author login)", async () => {
    const res = await POST(postReq(valid));
    expect(res.status).toBe(200);
    expect(mockCreateOrgSkill).toHaveBeenCalledTimes(1);
    expect(mockCreateOrgSkill.mock.calls[0][2]).toBe("alice");
  });

  it("rejects a DECLARED but broken frontmatter block with 400 + the errors, no write", async () => {
    const content = `---
name: Not A Slug
description: X.
category: devops
---

body`;
    const res = await POST(postReq({ ...valid, content }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors.join(" ")).toMatch(/kebab-case/);
    expect(json.errors.join(" ")).toMatch(/category/);
    expect(mockCreateOrgSkill).not.toHaveBeenCalled();
  });

  it("frontmatter WINS: the stored columns are synced from the block", async () => {
    const content = `---
name: from-file
description: From the file.
category: security
---

body`;
    const res = await POST(postReq({ ...valid, content }));
    expect(res.status).toBe(200);
    expect(mockCreateOrgSkill.mock.calls[0][1]).toMatchObject({
      name: "from-file",
      description: "From the file.",
      category: "security",
      content,
    });
  });

  it("wraps a block-less body from the request fields (name becomes the slug)", async () => {
    expect((await POST(postReq(valid))).status).toBe(200);
    const input = mockCreateOrgSkill.mock.calls[0][1];
    expect(input.name).toBe("pr-review");
    expect(input.content).toContain(`---
name: pr-review
`);
    expect(input.content.endsWith("do the thing")).toBe(true);
  });

  it("maps a duplicate name (P2002) to 409", async () => {
    mockCreateOrgSkill.mockRejectedValue({ code: "P2002" });
    const res = await POST(postReq(valid));
    expect(res.status).toBe(409);
  });
});

describe("GET /api/org/skills — read gate", () => {
  it("requires ?org", async () => {
    const res = await GET(new Request("http://t/api/org/skills"));
    expect(res.status).toBe(400);
  });

  it("returns skills + the curated category list", async () => {
    mockListOrgSkills.mockResolvedValue([{ id: "s1" }]);
    const res = await GET(new Request("http://t/api/org/skills?org=acme&sort=downloads"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills).toEqual([{ id: "s1" }]);
    expect(Array.isArray(body.categories)).toBe(true);
    expect(body.categories).toContain("security");
    // the validated sort is forwarded
    expect(mockListOrgSkills.mock.calls[0][1]).toMatchObject({ sort: "downloads" });
  });

  it("denies an unauthorized reader verbatim", async () => {
    mockAuthorizeOrgApi.mockResolvedValue({ denied: Response.json({ error: "no" }, { status: 403 }) });
    const res = await GET(new Request("http://t/api/org/skills?org=acme"));
    expect(res.status).toBe(403);
    expect(mockListOrgSkills).not.toHaveBeenCalled();
  });
});
