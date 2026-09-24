// The role matrix of /api/org/members (backlog develop-2026-09-17 row 4, operator decision
// 2026-09-24): READING the roster is a member-level read, WRITING it stays owner-only.
//
// The gate mock here is not a pass/deny switch like route.test.ts's: it resolves a caller ROLE and
// answers `requireOrgRole(org, min)` by rank, exactly as the real gate does. So each case states a
// fact about the route ("a viewer cannot list the roster") rather than about which `min` it passes,
// and a route that asked for the wrong minimum fails here as a wrong status, not a wrong argument.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn() }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/db/members", async (orig) => {
  const actual = await orig<typeof import("@/lib/db/members")>();
  return { isOrgRole: actual.isOrgRole, normalizeLogin: actual.normalizeLogin };
});
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getMembershipRole: vi.fn(async () => "member"),
  listOrgMembers: vi.fn(async () => [
    { login: "alice", name: "Alice", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" },
  ]),
  recordOrgAudit: vi.fn(async () => true),
  setMembershipRole: vi.fn(async () => "ok"),
  removeMembership: vi.fn(async () => "ok"),
}));

import { GET, POST, DELETE } from "./route";
import { requireOrgRole } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { listOrgMembers, setMembershipRole, removeMembership } from "@/lib/db";
import type { OrgRole } from "@/lib/db/members";

const RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
let callerRole: OrgRole = "owner";

const mockGate = vi.mocked(requireOrgRole);
const mockViewer = vi.mocked(resolveViewerLogin);
const mockList = vi.mocked(listOrgMembers);
const mockSet = vi.mocked(setMembershipRole);
const mockRemove = vi.mocked(removeMembership);

beforeEach(() => {
  vi.clearAllMocks();
  mockGate.mockImplementation(async (_org: string, min: OrgRole) =>
    RANK[callerRole] >= RANK[min]
      ? null
      : (Response.json({ error: `This action requires the ${min} role.` }, { status: 403 }) as never),
  );
  mockViewer.mockResolvedValue("caller");
});

const getReq = () => GET(new Request("http://localhost/api/org/members?org=Acme"));
const postReq = () =>
  POST(
    new Request("http://localhost/api/org/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: "acme", login: "bob", role: "admin" }),
    }),
  );
const deleteOther = () => DELETE(new Request("http://localhost/api/org/members?org=acme&login=bob", { method: "DELETE" }));
const deleteSelf = () => DELETE(new Request("http://localhost/api/org/members?org=acme&login=caller", { method: "DELETE" }));

describe("GET /api/org/members: the roster is readable from member up", () => {
  it("a viewer gets 403 and the roster is never read", async () => {
    callerRole = "viewer";
    const res = await getReq();
    expect(res.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it.each(["member", "admin", "owner"] as const)("a %s gets 200 with the roster", async (role) => {
    callerRole = role;
    const res = await getReq();
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith("acme");
    const body = (await res.json()) as { members: { login: string }[] };
    expect(body.members.map((m) => m.login)).toEqual(["alice"]);
  });
});

describe("POST /api/org/members: guard: a role change stays owner-only", () => {
  it.each(["viewer", "member", "admin"] as const)("guard: a %s gets 403 and no role is written", async (role) => {
    callerRole = role;
    const res = await postReq();
    expect(res.status).toBe(403);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("guard: an owner changes the role", async () => {
    callerRole = "owner";
    const res = await postReq();
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith("acme", "bob", "admin");
  });
});

describe("DELETE /api/org/members: guard: removing another member stays owner-only", () => {
  it.each(["viewer", "member", "admin"] as const)("guard: a %s cannot remove someone else", async (role) => {
    callerRole = role;
    const res = await deleteOther();
    expect(res.status).toBe(403);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("guard: an owner removes someone else", async () => {
    callerRole = "owner";
    const res = await deleteOther();
    expect(res.status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith("acme", "bob");
  });

  it.each(["viewer", "member", "admin"] as const)("guard: a %s may still leave on their own", async (role) => {
    callerRole = role;
    const res = await deleteSelf();
    expect(res.status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith("acme", "caller");
  });
});
