// Route test for POST /api/org/skills/push — the TOKEN-principal write door (the other three are
// cookie doors). It had no test file at all, which is how its entitlement drifted away from the other
// three in the first place. Pinned here:
//   - the door decision comes from the ONE gate (src/lib/org/skill-write-gate.ts), which runs REAL in
//     this file: only the db facts under it are mocked, so the push row of the door table is what
//     decides, not a mock of the decision;
//   - a personal free workspace is refused 403 with the DECISION NAME in the body, while the create
//     door (imported here too) accepts the same workspace — the declared exception, asserted across
//     two routes in one file;
//   - a push to an ARCHIVED name is 409 { status: "archived" }, never a silent 200 "updated" that
//     writes a row no list or manifest shows, and it records no audit;
//   - an identical body is still 200 "unchanged" with no audit (idempotency guard).

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
  mockPushOrgSkill,
  mockCreateOrgSkill,
  mockListOrgSkills,
  mockRecordOrgAudit,
  mockGetCreditState,
  mockIsPersonalOrg,
  mockGetPersonalUsage,
  mockAuthorizeOrgApi,
  mockPrincipalLogin,
} = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockPushOrgSkill: vi.fn(),
  mockCreateOrgSkill: vi.fn(),
  mockListOrgSkills: vi.fn(),
  mockRecordOrgAudit: vi.fn(),
  mockGetCreditState: vi.fn(),
  mockIsPersonalOrg: vi.fn(),
  mockGetPersonalUsage: vi.fn(),
  mockAuthorizeOrgApi: vi.fn(),
  mockPrincipalLogin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: mockIsDbConfigured,
  pushOrgSkill: mockPushOrgSkill,
  createOrgSkill: mockCreateOrgSkill,
  listOrgSkills: mockListOrgSkills,
  recordOrgAudit: mockRecordOrgAudit,
  getCreditState: mockGetCreditState,
  isPersonalOrg: mockIsPersonalOrg,
  getPersonalUsage: mockGetPersonalUsage,
  PERSONAL_SKILL_LIMIT: 10,
}));
// isDenied is a pure type guard ("denied" in r) — kept real; only the network/identity calls are mocked.
vi.mock("@/lib/api-token-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-token-auth")>();
  return { ...actual, authorizeOrgApi: mockAuthorizeOrgApi, principalLogin: mockPrincipalLogin };
});

import { POST as pushSkill } from "./route";
import { POST as createSkill } from "../route";

const pushReq = (body: unknown) =>
  new Request("http://t/api/org/skills/push", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", authorization: "Bearer askl_test" },
  });
const createReq = (body: unknown) =>
  new Request("http://t/api/org/skills", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", authorization: "Bearer askl_test" },
  });

const valid = { org: "acme", name: "deploy", content: "the body", category: "workflow", description: "Deploy." };

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockAuthorizeOrgApi.mockResolvedValue({ principal: { via: "token", label: "ci" } });
  mockPrincipalLogin.mockResolvedValue("token:ci");
  mockGetCreditState.mockResolvedValue({ plan: "team", balance: 0, unlimited: false });
  mockIsPersonalOrg.mockResolvedValue(false);
  mockGetPersonalUsage.mockResolvedValue({ skills: { used: 0, limit: 10 } });
  mockPushOrgSkill.mockResolvedValue({ status: "created", id: "skill_1", version: 1 });
  mockCreateOrgSkill.mockResolvedValue({ id: "skill_1" });
  mockListOrgSkills.mockResolvedValue([]);
});

/** A personal workspace on the free path: the one cell where push and create disagree BY DESIGN. */
function personalFree() {
  mockGetCreditState.mockResolvedValue({ plan: "free", balance: 0, unlimited: false });
  mockIsPersonalOrg.mockResolvedValue(true);
  mockGetPersonalUsage.mockResolvedValue({ skills: { used: 3, limit: 10 } });
}

describe("POST /api/org/skills/push — the entitlement door", () => {
  it("503 before any gate when the DB is off", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect((await pushSkill(pushReq(valid))).status).toBe(503);
    expect(mockAuthorizeOrgApi).not.toHaveBeenCalled();
  });

  it("denies an unauthorized token verbatim and never writes", async () => {
    mockAuthorizeOrgApi.mockResolvedValue({ denied: Response.json({ error: "no" }, { status: 403 }) });
    expect((await pushSkill(pushReq(valid))).status).toBe(403);
    expect(mockPushOrgSkill).not.toHaveBeenCalled();
  });

  it("refuses a personal free workspace 403 with the DECISION NAME, not a generic plan string", async () => {
    personalFree();
    const res = await pushSkill(pushReq({ ...valid, org: "me" }));
    expect(res.status).toBe(403);
    expect((await res.json()).decision).toBe("personal-door-closed");
    expect(mockPushOrgSkill).not.toHaveBeenCalled();
  });

  it("…while the CREATE door accepts that same workspace (the declared exception, both doors asserted)", async () => {
    personalFree();
    const res = await createSkill(createReq({ ...valid, org: "me", name: "PR review" }));
    expect(res.status).toBe(200);
    expect(mockCreateOrgSkill).toHaveBeenCalledTimes(1);
  });

  it("refuses a free NON-personal org with plan-required", async () => {
    mockGetCreditState.mockResolvedValue({ plan: "free", balance: 0, unlimited: false });
    const res = await pushSkill(pushReq(valid));
    expect(res.status).toBe(403);
    expect((await res.json()).decision).toBe("plan-required");
    expect(mockPushOrgSkill).not.toHaveBeenCalled();
  });

  it("a Team org pushes, and the live-skill count is never even read for the push door", async () => {
    const res = await pushSkill(pushReq(valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "created" });
    expect(mockGetPersonalUsage).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/skills/push — the archived name", () => {
  it("409 { status: \"archived\" } instead of a 200 that writes where nobody can see it", async () => {
    mockPushOrgSkill.mockResolvedValue({ status: "archived", id: "skill_arch", version: 4 });
    const res = await pushSkill(pushReq(valid));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe("archived");
    expect(body.error).toMatch(/archived/i);
    expect(mockRecordOrgAudit).not.toHaveBeenCalled();
  });

  it("still maps a stale baseVersion to 409 conflict (status codes stay distinguishable)", async () => {
    mockPushOrgSkill.mockResolvedValue({ status: "conflict", id: "s1", version: 7 });
    const res = await pushSkill(pushReq({ ...valid, baseVersion: 5 }));
    expect(res.status).toBe(409);
    expect((await res.json()).status).toBe("conflict");
    expect(mockRecordOrgAudit).not.toHaveBeenCalled();
  });

  it("an identical body is 200 unchanged and audits nothing (idempotency guard)", async () => {
    mockPushOrgSkill.mockResolvedValue({ status: "unchanged", id: "s1", version: 3 });
    const res = await pushSkill(pushReq(valid));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "unchanged", id: "s1", version: 3 });
    expect(mockRecordOrgAudit).not.toHaveBeenCalled();
  });

  it("audits a real create/update with the push source", async () => {
    const res = await pushSkill(pushReq(valid));
    expect(res.status).toBe(200);
    expect(mockRecordOrgAudit).toHaveBeenCalledWith(
      "org_skill.created",
      "acme",
      expect.objectContaining({ via: "push" }),
      "token:ci",
    );
  });
});
