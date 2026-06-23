// Pins the privilege-granting surface (members-access-control 06-18 #2): /api/org/members is where
// an owner mints `admin`/`owner`, so its OWNER-GATE and CSRF/same-origin guard must provably BLOCK
// before any membership write. A regression that reorders requireOrgRole(org,"owner") below the
// setMembershipRole/removeMembership mutation, drops the isSameOrigin check, or lets a non-owner past
// the gate is silent privilege-escalation / CSRF role-grant. These tests assert, ordering-sensitively:
// a denied gate or a cross-origin request returns the rejection AND the db write fn is NEVER called;
// an authorized owner on a same-origin request succeeds. The authz + auth + db boundaries are mocked
// (their own logic is unit-tested in authz.test.ts / auth.test.ts); isOrgRole keeps its real impl so
// role-shape validation behaves.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => ({
  isSameOrigin: vi.fn(() => true),
  getSession: vi.fn(async () => ({ login: "owner-actor" })),
}));
// Keep the REAL isOrgRole so the route's role-shape validation behaves; mock nothing else here.
vi.mock("@/lib/db/members", async (orig) => {
  const actual = await orig<typeof import("@/lib/db/members")>();
  return { isOrgRole: actual.isOrgRole };
});
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getMembershipRole: vi.fn(async () => "member"),
  listOrgMembers: vi.fn(async () => [{ login: "a", role: "owner" }]),
  // The route now audits via the consolidated recordOrgAudit (resolve-orgId-then-record), not the
  // raw recordAudit + getOrgId pair — so the audit assertions key on this mock.
  recordOrgAudit: vi.fn(async () => true),
  setMembershipRole: vi.fn(async () => "ok"),
  removeMembership: vi.fn(async () => "ok"),
}));

import { GET, POST, DELETE } from "./route";
import { requireOrgRole } from "@/lib/authz";
import { isSameOrigin, getSession } from "@/lib/auth";
import {
  setMembershipRole,
  removeMembership,
  recordOrgAudit,
  listOrgMembers,
} from "@/lib/db";

const mockGate = vi.mocked(requireOrgRole);
const mockSameOrigin = vi.mocked(isSameOrigin);
const mockSession = vi.mocked(getSession);
const mockSet = vi.mocked(setMembershipRole);
const mockRemove = vi.mocked(removeMembership);
const mockAudit = vi.mocked(recordOrgAudit);
const mockList = vi.mocked(listOrgMembers);

// A denied gate returns a NextResponse the route returns verbatim. Mirror requireOrgRole's real
// 403 denial shape so the test asserts the EXACT response is propagated.
const deny403 = () =>
  Response.json({ error: "This action requires the owner role in this organization." }, { status: 403 }) as never;

function postReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/org/members", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function deleteReq(org: string, login: string) {
  return new Request(
    `http://localhost/api/org/members?org=${encodeURIComponent(org)}&login=${encodeURIComponent(login)}`,
    { method: "DELETE" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGate.mockResolvedValue(null); // owner gate passes by default
  mockSameOrigin.mockReturnValue(true); // same-origin by default
  mockSession.mockResolvedValue({ login: "owner-actor" } as never);
  mockSet.mockResolvedValue("ok");
  mockRemove.mockResolvedValue("ok");
  mockList.mockResolvedValue([{ login: "a", role: "owner" }] as never);
});

describe("POST /api/org/members — owner gate blocks the role-grant write", () => {
  it("a non-owner (denied gate) gets the gate's 403 and setMembershipRole is NEVER called", async () => {
    mockGate.mockResolvedValue(deny403());
    const res = await POST(postReq({ org: "Acme", login: "alice", role: "admin" }));
    expect(res.status).toBe(403);
    expect(mockSet).not.toHaveBeenCalled(); // no membership write on a denied request
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("the gate is consulted with (canonical-org, 'owner') BEFORE the mutation", async () => {
    await POST(postReq({ org: "Acme", login: "alice", role: "admin" }));
    expect(mockGate).toHaveBeenCalledWith("acme", "owner");
  });

  it("an authorized owner on a same-origin request succeeds and writes once", async () => {
    mockGate.mockResolvedValue(null);
    const res = await POST(postReq({ org: "acme", login: "alice", role: "admin" }));
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith("acme", "alice", "admin");
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, login: "alice", role: "admin" });
  });
});

describe("POST /api/org/members — CSRF / same-origin guard", () => {
  it("rejects a cross-origin POST with 403 BEFORE the gate and BEFORE any write", async () => {
    mockSameOrigin.mockReturnValue(false);
    const res = await POST(postReq({ org: "acme", login: "alice", role: "admin" }));
    expect(res.status).toBe(403);
    expect(mockGate).not.toHaveBeenCalled(); // gate never reached on a cross-origin request
    expect(mockSet).not.toHaveBeenCalled(); // and no membership write
  });

  it("rejects an invalid role shape with 400 (before the gate's side effects)", async () => {
    const res = await POST(postReq({ org: "acme", login: "alice", role: "superuser" }));
    expect(res.status).toBe(400);
    expect(mockGate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("maps a last_owner outcome to 409", async () => {
    mockSet.mockResolvedValue("last_owner");
    const res = await POST(postReq({ org: "acme", login: "alice", role: "member" }));
    expect(res.status).toBe(409);
    expect(mockAudit).not.toHaveBeenCalled(); // no audit on a rejected mutation
  });

  it("maps an error outcome (unknown org) to 404", async () => {
    mockSet.mockResolvedValue("error");
    const res = await POST(postReq({ org: "acme", login: "alice", role: "member" }));
    expect(res.status).toBe(404);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/org/members — owner gate + CSRF block the removal", () => {
  it("a non-owner (denied gate) gets the gate's 403 and removeMembership is NEVER called", async () => {
    mockGate.mockResolvedValue(deny403());
    const res = await DELETE(deleteReq("acme", "alice"));
    expect(res.status).toBe(403);
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin DELETE with 403 BEFORE the gate and BEFORE any write", async () => {
    mockSameOrigin.mockReturnValue(false);
    const res = await DELETE(deleteReq("acme", "alice"));
    expect(res.status).toBe(403);
    expect(mockGate).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("an authorized owner on a same-origin request removes once and audits", async () => {
    const res = await DELETE(deleteReq("Acme", "alice"));
    expect(res.status).toBe(200);
    expect(mockGate).toHaveBeenCalledWith("acme", "owner"); // canonical org, owner min
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledTimes(1);
  });

  it("maps a not_found outcome to 404 (no audit)", async () => {
    mockRemove.mockResolvedValue("not_found");
    const res = await DELETE(deleteReq("acme", "ghost"));
    expect(res.status).toBe(404);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("GET /api/org/members — owner gate guards the read", () => {
  it("a denied gate returns the gate's 403 and listOrgMembers is NEVER called", async () => {
    mockGate.mockResolvedValue(deny403());
    const res = await GET(new Request("http://localhost/api/org/members?org=acme"));
    expect(res.status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("an authorized owner lists members", async () => {
    const res = await GET(new Request("http://localhost/api/org/members?org=acme"));
    expect(res.status).toBe(200);
    expect(mockGate).toHaveBeenCalledWith("acme", "owner");
    expect(mockList).toHaveBeenCalledTimes(1);
  });
});
