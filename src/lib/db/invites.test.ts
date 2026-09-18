// acceptInvite grant semantics (members-access-control 07-16 #2). The dangerous shape it pins:
// setMembershipRole UPSERTS unconditionally, so accepting an invite used to REWRITE an existing
// higher-role member's role down to the invite's (owner→viewer with one click on an unpinned link
// dropped in a channel), and a SOLE owner's `last_owner` policy refusal was collapsed into a
// misleading retryable "db" error. Now: an accepter whose existing role already covers the invited
// role gets a NO-OP grant (invite consumed, higher role kept, no membership write), and a policy
// refusal surfaces as its own `last_owner` reason with the invite released for re-use.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIsDbConfigured, mockGetPrisma, mockGetMembershipRole, mockSetMembershipRole, mockGetOrgId } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
  mockGetMembershipRole: vi.fn(),
  mockSetMembershipRole: vi.fn(),
  mockGetOrgId: vi.fn(async () => "org_1"),
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
    coerceStoredRole: actual.coerceStoredRole,
    roleAtLeast: actual.roleAtLeast,
    getMembershipRole: mockGetMembershipRole,
    setMembershipRole: mockSetMembershipRole,
  };
});
vi.mock("@/lib/db/org-rollup", () => ({
  getOrgId: mockGetOrgId,
}));

import { acceptInvite, listPendingInvites, peekInvite, resendInvite } from "./invites";

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
  mockGetOrgId.mockResolvedValue("org_1");
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

/** In-memory pending invite used to pin resend's in-place token rotate. */
function fakePendingPrisma(opts: { status?: string; token?: string; expired?: boolean; orgId?: string } = {}) {
  const store = {
    id: "inv_1",
    orgId: opts.orgId ?? "org_1",
    email: "invitee@example.test",
    githubLogin: null as string | null,
    role: "member",
    token: opts.token ?? "old_tok",
    status: opts.status ?? "pending",
    invitedBy: "octocat",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    expiresAt: opts.expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 6 * 86_400_000),
  };
  const invite = {
    create: vi.fn(),
    findFirst: vi.fn(async ({ where }: { where: { id?: string; orgId?: string; status?: string } }) => {
      if (where.id && where.id !== store.id) return null;
      if (where.orgId && where.orgId !== store.orgId) return null;
      if (where.status && where.status !== store.status) return null;
      return { ...store };
    }),
    findUnique: vi.fn(async ({ where }: { where: { token?: string } }) => {
      if (where.token !== store.token) return null;
      return {
        status: store.status,
        expiresAt: store.expiresAt,
        role: store.role,
        githubLogin: store.githubLogin,
        email: store.email,
        org: { slug: "acme" },
      };
    }),
    findMany: vi.fn(async () => [{ ...store }]),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id?: string; orgId?: string; status?: string; expiresAt?: { gt: Date } };
        data: Partial<typeof store>;
      }) => {
        if (where.id && where.id !== store.id) return { count: 0 };
        if (where.orgId && where.orgId !== store.orgId) return { count: 0 };
        if (where.status && where.status !== store.status) return { count: 0 };
        if (where.expiresAt?.gt && store.expiresAt.getTime() <= where.expiresAt.gt.getTime()) return { count: 0 };
        Object.assign(store, data);
        return { count: 1 };
      },
    ),
  };
  const prisma = {
    invite,
    $transaction: vi.fn(async (fn: (tx: { invite: typeof invite }) => unknown) => fn({ invite })),
  };
  return { prisma, store, invite };
}

describe("resendInvite — rotate in place, old token fails peekInvite", () => {
  it("overwrites the token in one transaction, mails nothing here, and leaves exactly one pending row", async () => {
    const { prisma, store, invite } = fakePendingPrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const out = await resendInvite("acme", "inv_1");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(invite.create).not.toHaveBeenCalled();
    expect(out).not.toBeNull();
    expect(out!.id).toBe("inv_1");
    expect(out!.token).not.toBe("old_tok");
    expect(out!.token).toBe(store.token);
    expect(store.status).toBe("pending");

    const listed = await listPendingInvites("acme");
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("token");
    expect(listed[0]!.id).toBe("inv_1");
  });

  it("old token peekInvite fails; the rotated token still peeks", async () => {
    const { prisma, store } = fakePendingPrisma({ token: "old_tok" });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await resendInvite("acme", "inv_1");
    expect(out?.token).toBeTruthy();
    expect(out!.token).not.toBe("old_tok");

    expect(await peekInvite("old_tok")).toEqual({ ok: false, reason: "not_found" });
    expect(await peekInvite(store.token)).toMatchObject({ ok: true, org: "acme", role: "member" });
  });

  it("does not rotate an already-consumed or expired invite", async () => {
    const used = fakePendingPrisma({ status: "accepted" });
    mockGetPrisma.mockReturnValue(used.prisma);
    expect(await resendInvite("acme", "inv_1")).toBeNull();
    expect(used.store.token).toBe("old_tok");

    const expired = fakePendingPrisma({ expired: true });
    mockGetPrisma.mockReturnValue(expired.prisma);
    expect(await resendInvite("acme", "inv_1")).toBeNull();
    expect(expired.store.token).toBe("old_tok");
  });

  it("returns null when the org is unknown or the db is off", async () => {
    mockGetOrgId.mockResolvedValueOnce(null);
    expect(await resendInvite("ghost", "inv_1")).toBeNull();

    mockIsDbConfigured.mockReturnValueOnce(false);
    expect(await resendInvite("acme", "inv_1")).toBeNull();
  });
});

describe("listPendingInvites never re-broadcasts the token", () => {
  it("strips token from every row even when prisma selected it", async () => {
    const { prisma } = fakePendingPrisma({ token: "secret_capability" });
    mockGetPrisma.mockReturnValue(prisma);
    const listed = await listPendingInvites("acme");
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("token");
    expect(JSON.stringify(listed)).not.toContain("secret_capability");
  });
});
