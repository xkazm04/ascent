// acceptInvite grant semantics (members-access-control 07-16 #2). The dangerous shape it pins:
// setMembershipRole UPSERTS unconditionally, so accepting an invite used to REWRITE an existing
// higher-role member's role down to the invite's (owner→viewer with one click on an unpinned link
// dropped in a channel), and a SOLE owner's `last_owner` policy refusal was collapsed into a
// misleading retryable "db" error. Now: an accepter whose existing role already covers the invited
// role gets a NO-OP grant (invite consumed, higher role kept, no membership write), and a policy
// refusal surfaces as its own `last_owner` reason with the invite released for re-use.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIsDbConfigured, mockGetPrisma, mockGetMembershipRole, mockSetMembershipRole } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
  mockGetMembershipRole: vi.fn(),
  mockSetMembershipRole: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getPrisma: mockGetPrisma,
  isDbConfigured: mockIsDbConfigured,
}));
// Keep the REAL role lattice (roleAtLeast/isOrgRole) — the never-downgrade decision hangs on it —
// and mock only the DB-touching member functions.
vi.mock("@/lib/db/members", async (orig) => {
  const actual = await orig<typeof import("@/lib/db/members")>();
  return {
    isOrgRole: actual.isOrgRole,
    roleAtLeast: actual.roleAtLeast,
    getMembershipRole: mockGetMembershipRole,
    setMembershipRole: mockSetMembershipRole,
  };
});

import { acceptInvite } from "./invites";

/** Fake prisma for the invite rows: a pending, unexpired, unpinned invite for org "acme". */
function fakeInvitePrisma(opts: { role?: string; email?: string | null } = {}) {
  const statusFlips: Array<{ where: { status: string }; to: string }> = [];
  const prisma = {
    invite: {
      findUnique: vi.fn(async () => ({
        id: "inv_1",
        status: "pending",
        expiresAt: new Date(Date.now() + 60_000),
        role: opts.role ?? "viewer",
        githubLogin: null,
        email: opts.email ?? null,
        org: { slug: "acme" },
      })),
      updateMany: vi.fn(async (args: { where: { status: string }; data: { status: string } }) => {
        statusFlips.push({ where: { status: args.where.status }, to: args.data.status });
        return { count: 1 };
      }),
    },
  };
  return { prisma, statusFlips };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("acceptInvite — never downgrade an existing member", () => {
  it("an existing OWNER accepting a viewer invite keeps owner: no-op grant, no membership write, invite consumed", async () => {
    const { prisma, statusFlips } = fakeInvitePrisma({ role: "viewer" });
    mockGetPrisma.mockReturnValue(prisma);
    mockGetMembershipRole.mockResolvedValue("owner");

    const res = await acceptInvite("tok", { login: "Alice" });

    expect(res).toEqual({ ok: true, org: "acme", role: "owner" }); // old code: role rewritten to "viewer"
    expect(mockSetMembershipRole).not.toHaveBeenCalled(); // NO write — the role can't be lowered
    expect(statusFlips).toEqual([{ where: { status: "pending" }, to: "accepted" }]); // still single-use
  });

  it("an existing admin accepting an equal (admin) invite is also a no-op grant", async () => {
    const { prisma } = fakeInvitePrisma({ role: "admin" });
    mockGetPrisma.mockReturnValue(prisma);
    mockGetMembershipRole.mockResolvedValue("admin");

    const res = await acceptInvite("tok", { login: "bob" });

    expect(res).toEqual({ ok: true, org: "acme", role: "admin" });
    expect(mockSetMembershipRole).not.toHaveBeenCalled();
  });

  it("an existing viewer accepting an ADMIN invite is a genuine upgrade — grant runs", async () => {
    const { prisma } = fakeInvitePrisma({ role: "admin" });
    mockGetPrisma.mockReturnValue(prisma);
    mockGetMembershipRole.mockResolvedValue("viewer");
    mockSetMembershipRole.mockResolvedValue("ok");

    const res = await acceptInvite("tok", { login: "carol" });

    expect(res).toEqual({ ok: true, org: "acme", role: "admin" });
    expect(mockSetMembershipRole).toHaveBeenCalledWith("acme", "carol", "admin");
  });

  it("a non-member accepting grants the invited role (unchanged happy path)", async () => {
    const { prisma } = fakeInvitePrisma({ role: "member" });
    mockGetPrisma.mockReturnValue(prisma);
    mockGetMembershipRole.mockResolvedValue(null);
    mockSetMembershipRole.mockResolvedValue("ok");

    const res = await acceptInvite("tok", { login: "dave" });

    expect(res).toEqual({ ok: true, org: "acme", role: "member" });
  });
});

// The email pin is only as strong as the address getViewer hands over. getViewer now omits the email
// entirely when Supabase has NOT confirmed it (src/lib/access.ts), so an attacker holding an
// unconfirmed victim@example.com account reaches acceptInvite with NO email and lands here — the
// closed branch — instead of matching the victim's pin and joining their org.
describe("acceptInvite — an email-pinned invite binds to a confirmed address only", () => {
  it("refuses (wrong_email) when the viewer carries no email — the unconfirmed-account case", async () => {
    const { prisma, statusFlips } = fakeInvitePrisma({ role: "admin", email: "victim@example.com" });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await acceptInvite("tok", { login: "attacker" });

    expect(res).toEqual({ ok: false, reason: "wrong_email" });
    expect(mockSetMembershipRole).not.toHaveBeenCalled();
    expect(statusFlips).toEqual([]); // the invite is not even consumed
  });

  it("refuses (wrong_email) when the viewer's confirmed email is a DIFFERENT address", async () => {
    const { prisma } = fakeInvitePrisma({ role: "admin", email: "victim@example.com" });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await acceptInvite("tok", { login: "attacker", email: "attacker@example.com" });

    expect(res).toEqual({ ok: false, reason: "wrong_email" });
    expect(mockSetMembershipRole).not.toHaveBeenCalled();
  });

  it("grants when the viewer's confirmed email matches the pin (case/space-insensitively)", async () => {
    const { prisma } = fakeInvitePrisma({ role: "admin", email: "victim@example.com" });
    mockGetPrisma.mockReturnValue(prisma);
    mockGetMembershipRole.mockResolvedValue(null);
    mockSetMembershipRole.mockResolvedValue("ok");

    const res = await acceptInvite("tok", { login: "victim", email: "  Victim@Example.com " });

    expect(res).toEqual({ ok: true, org: "acme", role: "admin" });
    expect(mockSetMembershipRole).toHaveBeenCalledWith("acme", "victim", "admin");
  });
});

describe("acceptInvite — last_owner policy refusal is its own reason", () => {
  it("maps a last_owner grant refusal to reason 'last_owner' (not the retryable 'db') and releases the invite", async () => {
    const { prisma, statusFlips } = fakeInvitePrisma({ role: "viewer" });
    mockGetPrisma.mockReturnValue(prisma);
    // Role changed between the read and the grant: the read misses, the grant hits the guard.
    mockGetMembershipRole.mockResolvedValue(null);
    mockSetMembershipRole.mockResolvedValue("last_owner");

    const res = await acceptInvite("tok", { login: "alice" });

    expect(res).toEqual({ ok: false, reason: "last_owner" }); // old code: reason "db" → "try again" forever
    // The claim was released so the invite stays re-usable after a refused grant.
    expect(statusFlips).toEqual([
      { where: { status: "pending" }, to: "accepted" },
      { where: { status: "accepted" }, to: "pending" },
    ]);
  });

  it("keeps 'db' for genuine grant failures", async () => {
    const { prisma } = fakeInvitePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    mockGetMembershipRole.mockResolvedValue(null);
    mockSetMembershipRole.mockResolvedValue("db_error");

    const res = await acceptInvite("tok", { login: "alice" });

    expect(res).toEqual({ ok: false, reason: "db" });
  });
});
