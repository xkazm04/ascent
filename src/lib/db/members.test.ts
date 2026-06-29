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

import { isOrgRole, roleAtLeast, setMembershipRole, removeMembership, getMembershipRole } from "./members";
import { createInvite, listPendingInvites } from "./invites";

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

  it("returns 'db_error' (and writes nothing) when the transaction throws", async () => {
    const { prisma, writes, tx } = fakePrisma({ existingRole: "owner", ownerCount: 2 });
    tx.membership.upsert.mockRejectedValueOnce(new Error("db down"));
    mockGetPrisma.mockReturnValue(prisma);

    const res = await setMembershipRole("acme", "alice", "member");

    // Transient transaction failure is distinct from a missing org (which returns "error" → 404);
    // the route maps "db_error" to a 503 retry instead of a misleading "Unknown organization".
    expect(res).toBe("db_error");
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

// --- Canonical-identifier audit invariant (members-access-control.md HIGH #4) -------------------------
// The owner-gated route records ONE audit row per *successful* privilege mutation, carrying canonical
// identifiers — the resolved org id, the canonical (normalized) login — NOT a raw mixed-case client value
// and NOT a display name. The audit is gated on the mutation's success outcome and the membership row is
// written against those same resolved ids, so the trail can never name a different org/member than the one
// actually mutated. Equally load-bearing: a DENIED/failed mutation (last_owner / error / not_found) must
// fire NO membership write — that "no write" is the precondition the route relies on to never log a
// phantom audit row. These tests pin both halves at the data layer the route trusts.
//
// `tracePrisma` resolves the slug -> a fixed canonical orgId and captures the EXACT { orgId, login, role }
// the mutation hands to the membership write, plus the login carried into every user lookup/upsert — so a
// test can assert the canonical identifiers reaching the write equal the resolved org + normalized login,
// never the raw mixed-case input.
function tracePrisma(opts: { existingRole?: "owner" | "admin" | "member" | "viewer" | null; ownerCount?: number } = {}) {
  const existingRole = opts.existingRole === undefined ? null : opts.existingRole;
  const ownerCount = opts.ownerCount ?? 0;
  const CANONICAL_ORG_ID = "org_canonical";
  const CANONICAL_USER_ID = "user_canonical";

  // Every identifier that reaches a write/lookup, captured verbatim for canonical-value assertions.
  const orgSlugLookups: string[] = [];
  const userLoginLookups: string[] = [];
  const writes: Array<{ op: "upsert" | "delete"; orgId?: string; userId?: string; role?: string }> = [];

  const count = vi.fn(async () => ownerCount);
  const findUnique = vi.fn(async () => (existingRole === null ? null : { role: existingRole }));
  const upsert = vi.fn(async (args: { where: { orgId_userId: { orgId: string; userId: string } }; create: { role: string } }) => {
    writes.push({ op: "upsert", orgId: args.where.orgId_userId.orgId, userId: args.where.orgId_userId.userId, role: args.create.role });
    return {};
  });
  const del = vi.fn(async (args: { where: { orgId_userId: { orgId: string; userId: string } } }) => {
    writes.push({ op: "delete", orgId: args.where.orgId_userId.orgId, userId: args.where.orgId_userId.userId });
    return {};
  });

  const tx = { membership: { count, findUnique, upsert, delete: del } };

  const prisma = {
    organization: {
      findUnique: vi.fn(async (args: { where: { slug: string } }) => {
        orgSlugLookups.push(args.where.slug);
        return { id: CANONICAL_ORG_ID };
      }),
    },
    user: {
      upsert: vi.fn(async (args: { where: { githubLogin: string } }) => {
        userLoginLookups.push(args.where.githubLogin);
        return { id: CANONICAL_USER_ID };
      }),
      findUnique: vi.fn(async (args: { where: { githubLogin: string } }) => {
        userLoginLookups.push(args.where.githubLogin);
        return { id: CANONICAL_USER_ID };
      }),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };

  return { prisma, tx, writes, orgSlugLookups, userLoginLookups, CANONICAL_ORG_ID, CANONICAL_USER_ID };
}

describe("canonical-identifier audit invariant", () => {
  describe("a SUCCESSFUL privileged mutation writes against the canonical resolved org + normalized login", () => {
    it("setMembershipRole canonicalizes a mixed-case login + slug to the resolved ids the audit will carry", async () => {
      const { prisma, writes, orgSlugLookups, userLoginLookups, CANONICAL_ORG_ID, CANONICAL_USER_ID } = tracePrisma({
        existingRole: "member",
        ownerCount: 2,
      });
      mockGetPrisma.mockReturnValue(prisma);

      // Raw client input is mixed-case + padded — the route lowercases the slug, the data layer normalizes
      // the login. The audit must end up keyed on the CANONICAL values, not these raw strings.
      const res = await setMembershipRole("Acme", "  AliceLogin  ", "admin");

      expect(res).toBe("ok");
      // The single write carries the canonical resolved orgId + userId (never a raw/display value) and the new role.
      expect(writes).toEqual([{ op: "upsert", orgId: CANONICAL_ORG_ID, userId: CANONICAL_USER_ID, role: "admin" }]);
      // The login that reached the user upsert is the NORMALIZED (trimmed + lowercased) form — the same
      // canonicalization the route's audit `login.toLowerCase()` relies on, not the raw "  AliceLogin  ".
      expect(userLoginLookups).toContain("alicelogin");
      expect(userLoginLookups).not.toContain("  AliceLogin  ");
      expect(userLoginLookups).not.toContain("AliceLogin");
      // The org slug is CANONICALIZED (trimmed + lowercased) by the shared getOrgId resolver before the
      // lookup — org rows are persisted with a lowercased slug, so a mixed-case "Acme" resolves to the
      // same single canonical orgId as "acme" (never two divergent org identities for one request).
      expect(orgSlugLookups).toContain("acme");
      expect(orgSlugLookups).not.toContain("Acme");
    });

    it("removeMembership writes a delete keyed on the canonical resolved org + normalized login", async () => {
      const { prisma, writes, userLoginLookups, CANONICAL_ORG_ID, CANONICAL_USER_ID } = tracePrisma({
        existingRole: "member",
        ownerCount: 2,
      });
      mockGetPrisma.mockReturnValue(prisma);

      const res = await removeMembership("acme", "  BobLogin  ");

      expect(res).toBe("ok");
      expect(writes).toEqual([{ op: "delete", orgId: CANONICAL_ORG_ID, userId: CANONICAL_USER_ID }]);
      expect(userLoginLookups).toContain("boblogin"); // normalized, not the raw mixed-case/padded value
      expect(userLoginLookups).not.toContain("  BobLogin  ");
    });
  });

  describe("a DENIED/failed mutation fires NO write — so the route can never log a phantom audit row", () => {
    it("setMembershipRole last-owner denial leaves no membership write to audit", async () => {
      const { prisma, writes } = tracePrisma({ existingRole: "owner", ownerCount: 1 });
      mockGetPrisma.mockReturnValue(prisma);

      const res = await setMembershipRole("acme", "alice", "member");

      expect(res).toBe("last_owner"); // route maps this to 409 and skips recordAudit
      expect(writes).toHaveLength(0); // nothing to audit
    });

    it("setMembershipRole transaction failure ('db_error') leaves no membership write to audit", async () => {
      const { prisma, writes, tx } = tracePrisma({ existingRole: "member", ownerCount: 2 });
      tx.membership.upsert.mockRejectedValueOnce(new Error("db down"));
      mockGetPrisma.mockReturnValue(prisma);

      const res = await setMembershipRole("acme", "alice", "member");

      // A transient write failure is now distinct from "unknown org": the route maps it to 503
      // ("try again"), not a misleading 404 "Unknown organization". Either way: no write to audit.
      expect(res).toBe("db_error");
      expect(writes).toHaveLength(0);
    });

    it("removeMembership last-owner denial leaves no membership write to audit", async () => {
      const { prisma, writes } = tracePrisma({ existingRole: "owner", ownerCount: 1 });
      mockGetPrisma.mockReturnValue(prisma);

      const res = await removeMembership("acme", "alice");

      expect(res).toBe("last_owner"); // route maps this to 409 and skips recordAudit
      expect(writes).toHaveLength(0);
    });

    it("removeMembership of an unknown member ('not_found') leaves no membership write to audit", async () => {
      const { prisma, writes } = tracePrisma({ existingRole: null, ownerCount: 2 });
      mockGetPrisma.mockReturnValue(prisma);

      const res = await removeMembership("acme", "ghost");

      expect(res).toBe("not_found"); // route maps this to 404 and skips recordAudit
      expect(writes).toHaveLength(0);
    });
  });
});

// --- getMembershipRole resolution-miss invariant (members-access-control.md MEDIUM #5) ----------------
// getMembershipRole is the role resolver requireOrgRole trusts: `null` means "no role → deny/claim", a
// non-null OrgRole grants exactly that role. It walks three independent lookups — user (by githubLogin),
// org (by slug), membership (by orgId_userId) — each guarded by an early `return null`. The load-bearing
// invariant: ANY miss (DB-off, blank login, unknown user, unknown org, no membership row) yields `null`
// and NEVER a crash, a default-grant, or a stray truthy role; a present-but-corrupted role string is
// coerced down to "member" (the DB-corruption guard at members.ts:70), never surfaced raw to RBAC.
//
// `resolverPrisma` lets each leg of the walk independently resolve or miss: `user`/`org` are the lookup
// results (null = miss), `membershipRole` is the stored role string (null = no row). It records the exact
// githubLogin + slug + orgId_userId reaching each lookup so a test can assert the normalized login is used
// and that a downstream lookup is SKIPPED once an upstream leg misses (short-circuit, no wasted query).
function resolverPrisma(opts: {
  user?: { id: string } | null;
  org?: { id: string } | null;
  membershipRole?: string | null;
} = {}) {
  const user = opts.user === undefined ? { id: "user_1" } : opts.user;
  const org = opts.org === undefined ? { id: "org_1" } : opts.org;
  const membershipRole = opts.membershipRole === undefined ? null : opts.membershipRole;

  const userLoginLookups: string[] = [];
  const orgSlugLookups: string[] = [];
  const membershipKeys: Array<{ orgId: string; userId: string }> = [];

  const prisma = {
    user: {
      findUnique: vi.fn(async (args: { where: { githubLogin: string } }) => {
        userLoginLookups.push(args.where.githubLogin);
        return user;
      }),
    },
    organization: {
      findUnique: vi.fn(async (args: { where: { slug: string } }) => {
        orgSlugLookups.push(args.where.slug);
        return org;
      }),
    },
    membership: {
      findUnique: vi.fn(async (args: { where: { orgId_userId: { orgId: string; userId: string } } }) => {
        membershipKeys.push(args.where.orgId_userId);
        return membershipRole === null ? null : { role: membershipRole };
      }),
    },
  };

  return { prisma, userLoginLookups, orgSlugLookups, membershipKeys };
}

describe("getMembershipRole resolution misses", () => {
  it("returns null when the DB is not configured (documented DB-off value), never touching Prisma", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    // getPrisma must not be consulted at all when the DB is off.
    mockGetPrisma.mockImplementation(() => {
      throw new Error("getPrisma should not be called when DB is unconfigured");
    });

    await expect(getMembershipRole("acme", "alice")).resolves.toBeNull();
  });

  it("returns null for a blank login (after trim) before any user lookup", async () => {
    const { prisma, userLoginLookups } = resolverPrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await expect(getMembershipRole("acme", "   ")).resolves.toBeNull();
    expect(userLoginLookups).toHaveLength(0); // short-circuits before hitting the DB
  });

  it("returns null for an unknown user (user lookup miss) and never resolves the org", async () => {
    const { prisma, userLoginLookups, orgSlugLookups, membershipKeys } = resolverPrisma({ user: null });
    mockGetPrisma.mockReturnValue(prisma);

    await expect(getMembershipRole("acme", "ghost")).resolves.toBeNull();
    expect(userLoginLookups).toEqual(["ghost"]); // user lookup ran, with the normalized login
    expect(orgSlugLookups).toHaveLength(0); // org lookup short-circuited
    expect(membershipKeys).toHaveLength(0); // membership lookup short-circuited
  });

  it("returns null for an unknown org (org lookup miss) and never reads a membership row", async () => {
    const { prisma, orgSlugLookups, membershipKeys } = resolverPrisma({ user: { id: "user_1" }, org: null });
    mockGetPrisma.mockReturnValue(prisma);

    await expect(getMembershipRole("no-such-org", "alice")).resolves.toBeNull();
    expect(orgSlugLookups).toEqual(["no-such-org"]); // org lookup ran
    expect(membershipKeys).toHaveLength(0); // membership lookup short-circuited
  });

  it("returns null when the user + org resolve but no membership row exists (no default-grant)", async () => {
    const { prisma, membershipKeys } = resolverPrisma({
      user: { id: "user_1" },
      org: { id: "org_1" },
      membershipRole: null,
    });
    mockGetPrisma.mockReturnValue(prisma);

    await expect(getMembershipRole("acme", "alice")).resolves.toBeNull();
    // The membership lookup DID run, keyed on the resolved org + user ids — the miss is the row, not a skip.
    expect(membershipKeys).toEqual([{ orgId: "org_1", userId: "user_1" }]);
  });

  it("normalizes the login (trim + lowercase) before the user lookup", async () => {
    const { prisma, userLoginLookups } = resolverPrisma({ user: null });
    mockGetPrisma.mockReturnValue(prisma);

    await getMembershipRole("acme", "  AliceLogin  ");
    expect(userLoginLookups).toEqual(["alicelogin"]); // not "  AliceLogin  ", not "AliceLogin"
  });

  it("returns the stored role when a valid membership row exists", async () => {
    const { prisma } = resolverPrisma({
      user: { id: "user_1" },
      org: { id: "org_1" },
      membershipRole: "admin",
    });
    mockGetPrisma.mockReturnValue(prisma);

    await expect(getMembershipRole("acme", "alice")).resolves.toBe("admin");
  });

  it("coerces a corrupted/legacy non-OrgRole stored value down to 'member' (never surfaces it raw to RBAC)", async () => {
    const { prisma } = resolverPrisma({
      user: { id: "user_1" },
      org: { id: "org_1" },
      membershipRole: "superuser", // not one of owner|admin|member|viewer
    });
    mockGetPrisma.mockReturnValue(prisma);

    await expect(getMembershipRole("acme", "alice")).resolves.toBe("member");
  });

  it("yields a valid OrgRole or null on every shape — never throws across the resolution walk", async () => {
    // Sweep each miss leg + the happy path; the resolver must always settle to OrgRole|null, never reject.
    const cases: Array<{ p: ReturnType<typeof resolverPrisma>["prisma"]; expected: string | null }> = [
      { p: resolverPrisma({ user: null }).prisma, expected: null },
      { p: resolverPrisma({ org: null }).prisma, expected: null },
      { p: resolverPrisma({ membershipRole: null }).prisma, expected: null },
      { p: resolverPrisma({ membershipRole: "owner" }).prisma, expected: "owner" },
      { p: resolverPrisma({ membershipRole: "" }).prisma, expected: "member" }, // empty string is not an OrgRole
    ];
    for (const { p, expected } of cases) {
      mockGetPrisma.mockReturnValue(p);
      const r = await getMembershipRole("acme", "alice");
      expect(r === null || isOrgRole(r)).toBe(true);
      expect(r).toBe(expected);
    }
  });
});

// --- Canonical slug normalization shared across members + invites (members-access-control.md HIGH #1) -
// members.ts and invites.ts both used to keep a PRIVATE orgIdForSlug, and they had drifted: invites
// lowercased the slug, members did not, and orgHasOwner pushed the slug through the LOGIN normalizer.
// Both now route through the single exported getOrgId, which canonicalizes (trim + lowercase) to match
// how org rows are PERSISTED (the GitHub-App install flow stores `login.toLowerCase()` as the slug).
// This locks that a mixed-case / padded slug resolves to the SAME lowercased lookup from BOTH modules —
// so a lookup can never miss just because a caller forgot to pre-lowercase.
describe("canonical slug normalization is shared + consistent across members and invites", () => {
  /** Prisma fake whose org/invite lookups capture the exact slug that reached organization.findUnique. */
  function slugTracePrisma() {
    const orgSlugLookups: string[] = [];
    const prisma = {
      organization: {
        findUnique: vi.fn(async (args: { where: { slug: string } }) => {
          orgSlugLookups.push(args.where.slug);
          return { id: "org_1" };
        }),
      },
      user: { findUnique: vi.fn(async () => ({ id: "user_1" })) },
      membership: { findUnique: vi.fn(async () => null) },
      invite: {
        create: vi.fn(async () => ({
          id: "inv_1",
          email: null,
          githubLogin: null,
          role: "member",
          token: "tok",
          invitedBy: null,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 1000),
        })),
        findMany: vi.fn(async () => []),
      },
    };
    return { prisma, orgSlugLookups };
  }

  it("members.getMembershipRole canonicalizes a mixed-case + padded slug to lowercase before the lookup", async () => {
    const { prisma, orgSlugLookups } = slugTracePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await getMembershipRole("  Acme-Corp  ", "alice");

    expect(orgSlugLookups).toEqual(["acme-corp"]); // trimmed + lowercased, never the raw "  Acme-Corp  "
  });

  it("invites.createInvite + listPendingInvites resolve the SAME canonical slug as members", async () => {
    const { prisma, orgSlugLookups } = slugTracePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    await createInvite("  Acme-Corp  ", { role: "member" });
    await listPendingInvites("ACME-CORP");

    // Both invite paths reach getOrgId with the identical lowercased slug members resolves to — no drift.
    expect(orgSlugLookups).toEqual(["acme-corp", "acme-corp"]);
  });
});
