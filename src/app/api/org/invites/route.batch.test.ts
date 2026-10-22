// POST /api/org/invites { action: "batch" } (members-1). The server re-classifies every target
// against the roster and the pending list it reads itself, so a stale or hand-built client plan can
// never mint an invite for an existing member or a second live link for a pending invitee. Every
// refusal is pinned to "nothing was created".

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  createInvite: vi.fn(),
  listOrgMembers: vi.fn(async () => [{ login: "bob", name: null, role: "admin", createdAt: "2026-01-01T00:00:00.000Z" }]),
  listPendingInvites: vi.fn(async () => [
    { id: "inv_carol", email: null, githubLogin: "carol", role: "member", invitedBy: "octocat", createdAt: "2026-07-01T00:00:00.000Z", expiresAt: "2026-07-08T00:00:00.000Z" },
    { id: "inv_eve", email: "eve@x.io", githubLogin: null, role: "member", invitedBy: "octocat", createdAt: "2026-07-01T00:00:00.000Z", expiresAt: "2026-07-08T00:00:00.000Z" },
  ]),
  recordOrgAudit: vi.fn(async () => {}),
  revokeInvite: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgRole: vi.fn(async () => null),
  refusePublicOrgAdmin: (org: string) =>
    org === "public" ? new Response(JSON.stringify({ error: "public" }), { status: 403 }) : null,
}));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "octocat") }));
vi.mock("@/lib/email/invite", () => ({ dispatchInviteEmail: vi.fn(async () => ({ ok: true, skipped: false })) }));
vi.mock("@/lib/db/invites", () => ({ resendInvite: vi.fn() }));

import { POST } from "./route";
import { createInvite, recordOrgAudit } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { dispatchInviteEmail } from "@/lib/email/invite";

const mockCreate = vi.mocked(createInvite);
const mockAudit = vi.mocked(recordOrgAudit);
const mockRole = vi.mocked(requireOrgRole);
const mockOrigin = vi.mocked(requireSameOrigin);
const mockSend = vi.mocked(dispatchInviteEmail);

const post = (body: unknown) =>
  new Request("http://localhost/api/org/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const bodyOf = async (res: Response) => JSON.parse(await res.text());

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ASCENT_PUBLIC_URL = "https://ascent.test";
  mockRole.mockResolvedValue(null as never);
  mockOrigin.mockReturnValue(null as never);
  mockSend.mockResolvedValue({ ok: true, skipped: false });
  let n = 0;
  mockCreate.mockImplementation((async (_org: string, input: { role: string; email?: string | null; githubLogin?: string | null }) => {
    n += 1;
    return {
      id: `inv_new_${n}`,
      email: input.email ?? null,
      githubLogin: input.githubLogin ?? null,
      role: input.role,
      token: `tok_${n}`,
      invitedBy: "octocat",
      createdAt: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-07-08T00:00:00.000Z",
    };
  }) as never);
});

describe("POST batch: the server has the final say", () => {
  it("creates only the new target, answers every target in input order, audits the one it created", async () => {
    const res = await POST(post({ org: "acme", action: "batch", role: "member", targets: ["alice", "bob", "carol", "x y!"] }));
    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0]![1]).toMatchObject({ role: "member", githubLogin: "alice", invitedBy: "octocat" });
    const { results } = await bodyOf(res);
    expect(results).toMatchObject([
      { target: "alice", outcome: "created", invite: { token: "tok_1" } },
      { target: "bob", outcome: "already_member", role: "admin" },
      { target: "carol", outcome: "already_pending", inviteId: "inv_carol" },
      { target: "x y!", outcome: "invalid" },
    ]);
    const invited = mockAudit.mock.calls.filter((c) => c[0] === "org.member.invited");
    expect(invited).toHaveLength(1);
    expect(invited[0]![2]).toMatchObject({ org: "acme", role: "member", target: "alice" });
  });

  it("a repeated target in one batch is created once", async () => {
    const res = await POST(post({ org: "acme", action: "batch", role: "member", targets: ["dave", "Dave"] }));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect((await bodyOf(res)).results.map((r: { outcome: string }) => r.outcome)).toEqual(["created", "duplicate"]);
  });
});

describe("POST batch: every refusal creates nothing", () => {
  const ok = { org: "acme", action: "batch", role: "member", targets: ["alice"] };

  it("role owner -> 400", async () => {
    expect((await POST(post({ ...ok, role: "owner" }))).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("26 targets -> 400 (cap 25); an empty list -> 400", async () => {
    const many = Array.from({ length: 26 }, (_, i) => `user${i}`);
    expect((await POST(post({ ...ok, targets: many }))).status).toBe(400);
    expect((await POST(post({ ...ok, targets: [] }))).status).toBe(400);
    expect((await POST(post({ ...ok, targets: "alice" }))).status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("the public org -> 403", async () => {
    expect((await POST(post({ ...ok, org: "public" }))).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("a member (not owner) -> 403, and the gate asked for owner", async () => {
    mockRole.mockResolvedValue(new Response("nope", { status: 403 }) as never);
    expect((await POST(post(ok))).status).toBe(403);
    expect(mockRole).toHaveBeenCalledWith("acme", "owner");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("cross-origin -> 403", async () => {
    mockOrigin.mockReturnValue(new Response("x", { status: 403 }) as never);
    expect((await POST(post(ok))).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("POST batch: delivery per created row", () => {
  it("mails each CREATED email target once and never a pending or member row", async () => {
    mockSend.mockResolvedValueOnce({ ok: true, skipped: false }).mockResolvedValueOnce({ ok: false } as never);
    const res = await POST(post({ org: "acme", action: "batch", role: "member", targets: ["new1@x.io", "eve@x.io", "new2@x.io", "bob"] }));
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls.map((c) => c[0])).toEqual(["new1@x.io", "new2@x.io"]);
    const { results } = await bodyOf(res);
    expect(results).toMatchObject([
      { target: "new1@x.io", outcome: "created", emailed: "sent" },
      { target: "eve@x.io", outcome: "already_pending", inviteId: "inv_eve" },
      { target: "new2@x.io", outcome: "created", emailed: "failed" },
      { target: "bob", outcome: "already_member" },
    ]);
    expect(results[1].emailed).toBeUndefined();
  });

  it("notify:false suppresses every mail and reports emailed null", async () => {
    const res = await POST(post({ org: "acme", action: "batch", role: "member", targets: ["new1@x.io"], notify: false }));
    expect(mockSend).not.toHaveBeenCalled();
    expect((await bodyOf(res)).results[0]).toMatchObject({ outcome: "created", emailed: null });
  });
});
