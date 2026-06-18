// The role hierarchy that RBAC decisions hang on. Pure functions — the DB client is mocked away so
// importing the module never touches Prisma.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getPrisma: mockGetPrisma,
  isDbConfigured: mockIsDbConfigured,
}));

import { isOrgRole, roleAtLeast, setMembershipRole, removeMembership } from "./members";

describe("roleAtLeast", () => {
  it("orders owner > admin > member > viewer", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("admin", "owner")).toBe(false);
    expect(roleAtLeast("member", "admin")).toBe(false);
    expect(roleAtLeast("viewer", "member")).toBe(false);
    expect(roleAtLeast("member", "viewer")).toBe(true);
  });

  it("treats a null/absent role as below everything", () => {
    expect(roleAtLeast(null, "viewer")).toBe(false);
    expect(roleAtLeast(undefined, "viewer")).toBe(false);
  });
});

describe("isOrgRole", () => {
  it("accepts the four valid roles and rejects anything else", () => {
    for (const r of ["owner", "admin", "member", "viewer"]) expect(isOrgRole(r)).toBe(true);
    expect(isOrgRole("guest")).toBe(false);
    expect(isOrgRole("")).toBe(false);
  });
});

// --- DB guards: the last-owner CAS in setMembershipRole / removeMembership against a faked Prisma ---
// The pure-helper tests above never touch isDbConfigured. Here we flip it true and hand the module a
// fakePrisma whose $transaction(fn) => fn(tx) runs the guard body, so the count + write actually execute.
// Invariant under test: an org's owner count can never transition to 0 through these functions (TOCTOU-safe:
// the owner count is re-read on the SAME tx object that performs the write).

/**
 * Fake Prisma for the membership guards. `existingRole` is the role currently stored for the target
 * member (null = no row). `ownerCount` is what `tx.membership.count({ role:"owner" })` reports — the
 * value the last-owner guard reads *inside the transaction*. We record every upsert/delete so a test can
 * assert NO write fired when the guard rejects. The top-level + tx orgId/user lookups resolve to fixed ids.
 */
function fakePrisma(opts: { existingRole?: "owner" | "admin" | "member" | "viewer" | null; ownerCount?: number } = {}) {
  const existingRole = opts.existingRole === undefined ? null : opts.existingRole;
  const ownerCount = opts.ownerCount ?? 0;
  const writes: Array<{ op: "upsert" | "delete"; role?: string }> = [];

  const count = vi.fn(async () => ownerCount);
  const findUnique = vi.fn(async () => (existingRole === null ? null : { role: existingRole }));
  const upsert = vi.fn(async ({ create }: { create: { role: string } }) => {
    writes.push({ op: "upsert", role: create.role });
    return {};
  });
  const del = vi.fn(async () => {
    writes.push({ op: "delete" });
    return {};
  });

  const tx = { membership: { count, findUnique, upsert, delete: del } };

  const prisma = {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1" })) },
    user: {
      upsert: vi.fn(async () => ({ id: "user_1" })),
      findUnique: vi.fn(async () => ({ id: "user_1" })),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  return { prisma, tx, writes, count, upsert, del };
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("setMembershipRole last-owner guard", () => {
  it("REJECTS demoting the only owner (owner count would drop to 0) and writes no update", async () => {
    const { prisma, writes, count } = fakePrisma({ existingRole: "owner", ownerCount: 1 });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await setMembershipRole("acme", "Alice", "member");

    expect(res).toBe("last_owner");
    expect(writes).toHaveLength(0); // no upsert fired
    // The guard re-read the owner count on the transaction object (TOCTOU-safe), not outside it.
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("ALLOWS demoting one of several owners (count stays > 0) and writes the update", async () => {
    const { prisma, writes } = fakePrisma({ existingRole: "owner", ownerCount: 2 });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await setMembershipRole("acme", "alice", "member");

    expect(res).toBe("ok");
    expect(writes).toEqual([{ op: "upsert", role: "member" }]);
  });

  it("skips the guard entirely when the target is NOT currently an owner", async () => {
    const { prisma, writes, count } = fakePrisma({ existingRole: "member", ownerCount: 1 });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await setMembershipRole("acme", "bob", "admin");

    expect(res).toBe("ok");
    expect(count).not.toHaveBeenCalled(); // only fires for an existing owner being demoted
    expect(writes).toEqual([{ op: "upsert", role: "admin" }]);
  });

  it("skips the guard when PROMOTING to owner (role === 'owner' never demotes)", async () => {
    const { prisma, writes, count } = fakePrisma({ existingRole: "owner", ownerCount: 1 });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await setMembershipRole("acme", "alice", "owner");

    expect(res).toBe("ok");
    expect(count).not.toHaveBeenCalled();
    expect(writes).toEqual([{ op: "upsert", role: "owner" }]);
  });

  it("returns 'error' (and writes nothing) when the transaction throws", async () => {
    const { prisma, writes, tx } = fakePrisma({ existingRole: "owner", ownerCount: 2 });
    tx.membership.upsert.mockRejectedValueOnce(new Error("db down"));
    mockGetPrisma.mockReturnValue(prisma);

    const res = await setMembershipRole("acme", "alice", "member");

    expect(res).toBe("error");
    expect(writes).toHaveLength(0);
  });
});

describe("removeMembership last-owner guard", () => {
  it("REJECTS removing the only owner and writes no delete", async () => {
    const { prisma, writes, count } = fakePrisma({ existingRole: "owner", ownerCount: 1 });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await removeMembership("acme", "Alice");

    expect(res).toBe("last_owner");
    expect(writes).toHaveLength(0); // no delete fired
    expect(count).toHaveBeenCalledTimes(1); // owner count re-read inside the tx
  });

  it("ALLOWS removing one of several owners and writes the delete", async () => {
    const { prisma, writes } = fakePrisma({ existingRole: "owner", ownerCount: 3 });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await removeMembership("acme", "alice");

    expect(res).toBe("ok");
    expect(writes).toEqual([{ op: "delete" }]);
  });

  it("ALLOWS removing a non-owner without consulting the owner count", async () => {
    const { prisma, writes, count } = fakePrisma({ existingRole: "member", ownerCount: 1 });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await removeMembership("acme", "bob");

    expect(res).toBe("ok");
    expect(count).not.toHaveBeenCalled();
    expect(writes).toEqual([{ op: "delete" }]);
  });

  it("returns 'not_found' (and writes nothing) when the member has no membership row", async () => {
    const { prisma, writes, count } = fakePrisma({ existingRole: null, ownerCount: 1 });
    mockGetPrisma.mockReturnValue(prisma);

    const res = await removeMembership("acme", "ghost");

    expect(res).toBe("not_found");
    expect(count).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});
