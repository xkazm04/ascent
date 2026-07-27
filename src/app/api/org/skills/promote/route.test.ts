// Route test for /api/org/skills/promote (the promotion bridge). buildPromotedSkill is unit-tested
// separately (src/lib/org/skill-promote.test.ts) and mocked here, so this file pins ONLY what the route
// owns — the gate chain and its ORDER:
//   DB-configured -> body/repo validation -> member gate -> Team+/personal plan gate -> personal cap ->
//   SOURCE-repo read gate -> report exists -> create (409 on a repo already promoted).

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
  mockGetCreditState,
  mockWorkspaceAllowsSkills,
  mockPersonalSkillCapReached,
  mockCreateOrgSkill,
  mockRecordOrgAudit,
  mockGetScanReportByCommit,
  mockAuthorizeOrgApi,
  mockPrincipalLogin,
  mockReadableOrgForOwner,
  mockRequireOrgRead,
  mockBuildPromotedSkill,
} = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetCreditState: vi.fn(),
  mockWorkspaceAllowsSkills: vi.fn(),
  mockPersonalSkillCapReached: vi.fn(),
  mockCreateOrgSkill: vi.fn(),
  mockRecordOrgAudit: vi.fn(),
  mockGetScanReportByCommit: vi.fn(),
  mockAuthorizeOrgApi: vi.fn(),
  mockPrincipalLogin: vi.fn(),
  mockReadableOrgForOwner: vi.fn(),
  mockRequireOrgRead: vi.fn(),
  mockBuildPromotedSkill: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  getCreditState: mockGetCreditState,
  workspaceAllowsSkills: mockWorkspaceAllowsSkills,
  personalSkillCapReached: mockPersonalSkillCapReached,
  createOrgSkill: mockCreateOrgSkill,
  recordOrgAudit: mockRecordOrgAudit,
  getScanReportByCommit: mockGetScanReportByCommit,
  PERSONAL_SKILL_LIMIT: 10,
}));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: mockReadableOrgForOwner }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: mockRequireOrgRead }));
vi.mock("@/lib/org/skill-promote", () => ({ buildPromotedSkill: mockBuildPromotedSkill }));
// isDenied is a pure type guard — kept real; only the network/identity calls are mocked.
vi.mock("@/lib/api-token-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-token-auth")>();
  return { ...actual, authorizeOrgApi: mockAuthorizeOrgApi, principalLogin: mockPrincipalLogin };
});

import { POST } from "./route";

const req = (body: unknown) =>
  new Request("http://t/api/org/skills/promote", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const valid = { org: "acme", repo: "acme/api" };
const promoted = {
  name: "ascent-onboard-acme-api",
  description: "Personalized AI-native onboarding for acme/api.",
  category: "ai-native" as const,
  tags: ["ascent", "onboarding"],
  content: "---\nname: ascent-onboard-acme-api\ndescription: \"x\"\n---\n\nbody",
  trackIds: ["agent-in-loop"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockAuthorizeOrgApi.mockResolvedValue({ principal: { via: "session", login: "alice" } });
  mockPrincipalLogin.mockResolvedValue("alice");
  mockGetCreditState.mockResolvedValue({ plan: "team", balance: 0, unlimited: false });
  mockWorkspaceAllowsSkills.mockResolvedValue(true);
  mockPersonalSkillCapReached.mockResolvedValue(false);
  mockReadableOrgForOwner.mockResolvedValue("acme");
  mockRequireOrgRead.mockResolvedValue(null);
  mockGetScanReportByCommit.mockResolvedValue({ repo: { owner: "acme", name: "api" } });
  mockBuildPromotedSkill.mockReturnValue(promoted);
  mockCreateOrgSkill.mockResolvedValue({ id: "skill_1" });
  mockRecordOrgAudit.mockResolvedValue(undefined);
});

describe("POST /api/org/skills/promote", () => {
  it("503 when the DB is off, before any gate", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect((await POST(req(valid))).status).toBe(503);
    expect(mockAuthorizeOrgApi).not.toHaveBeenCalled();
  });

  it("400 on a missing/invalid repo, before any gate", async () => {
    expect((await POST(req({ org: "acme" }))).status).toBe(400);
    expect((await POST(req({ org: "acme", repo: "not-a-repo" }))).status).toBe(400);
    expect(mockAuthorizeOrgApi).not.toHaveBeenCalled();
  });

  it("denies a non-member verbatim and never reads the report or writes", async () => {
    mockAuthorizeOrgApi.mockResolvedValue({ denied: Response.json({ error: "no" }, { status: 403 }) });
    const res = await POST(req(valid));
    expect(res.status).toBe(403);
    expect(mockGetScanReportByCommit).not.toHaveBeenCalled();
    expect(mockCreateOrgSkill).not.toHaveBeenCalled();
  });

  it("403 on a workspace without the Skills Library, no write", async () => {
    mockWorkspaceAllowsSkills.mockResolvedValue(false);
    const res = await POST(req(valid));
    expect(res.status).toBe(403);
    expect(mockCreateOrgSkill).not.toHaveBeenCalled();
  });

  it("402 when a personal workspace is at its skill cap, no write", async () => {
    mockPersonalSkillCapReached.mockResolvedValue(true);
    const res = await POST(req(valid));
    expect(res.status).toBe(402);
    expect(mockCreateOrgSkill).not.toHaveBeenCalled();
  });

  it("gates the SOURCE repo read and scopes the report fetch to the readable org", async () => {
    mockReadableOrgForOwner.mockResolvedValue("public");
    await POST(req({ org: "acme", repo: "other/private" }));
    expect(mockRequireOrgRead).toHaveBeenCalledWith("public");
    expect(mockGetScanReportByCommit).toHaveBeenCalledWith("other", "private", {
      headSha: undefined,
      orgSlug: "public",
    });
  });

  it("denies an unreadable source verbatim, no write", async () => {
    mockRequireOrgRead.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }));
    const res = await POST(req(valid));
    expect(res.status).toBe(403);
    expect(mockCreateOrgSkill).not.toHaveBeenCalled();
  });

  it("404 when the repo has no saved scan (promotion never triggers a scan)", async () => {
    mockGetScanReportByCommit.mockResolvedValue(null);
    const res = await POST(req(valid));
    expect(res.status).toBe(404);
    expect(mockCreateOrgSkill).not.toHaveBeenCalled();
  });

  it("creates the library entry from the built skill and audits it", async () => {
    const res = await POST(req(valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "skill_1", name: promoted.name, trackIds: promoted.trackIds });
    const [org, input, actor] = mockCreateOrgSkill.mock.calls[0];
    expect(org).toBe("acme");
    expect(input).toEqual({
      name: promoted.name,
      category: "ai-native",
      content: promoted.content,
      description: promoted.description,
      tags: promoted.tags,
    });
    expect(actor).toBe("alice");
    expect(mockRecordOrgAudit.mock.calls[0][0]).toBe("org_skill.created");
    expect(mockRecordOrgAudit.mock.calls[0][2]).toMatchObject({ via: "promote", repo: "acme/api" });
  });

  it("409 when this repo was already promoted (P2002 on the unique name)", async () => {
    mockCreateOrgSkill.mockRejectedValue({ code: "P2002" });
    const res = await POST(req(valid));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain(promoted.name);
  });
});
