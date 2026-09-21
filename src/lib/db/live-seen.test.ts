// The ledger's anchor reads and writes ONE membership row — the one keyed by the org AND the named
// user — over a Prisma fake that records the where-shapes, so "writes only the caller's membership" is
// about the ids that actually ride in the query.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  users: { alice: "u-alice", bob: "u-bob" } as Record<string, string>,
  memberships: [] as { orgId: string; userId: string; liveSeenAt: Date | null }[],
  updates: [] as unknown[],
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    user: {
      findUnique: async ({ where }: { where: { githubLogin: string } }) => (h.users[where.githubLogin] ? { id: h.users[where.githubLogin] } : null),
    },
    membership: {
      findUnique: async ({ where }: { where: { orgId_userId: { orgId: string; userId: string } } }) =>
        h.memberships.find((m) => m.orgId === where.orgId_userId.orgId && m.userId === where.orgId_userId.userId) ?? null,
      updateMany: async (args: { where: { orgId: string; userId: string }; data: { liveSeenAt: Date } }) => {
        h.updates.push(args);
        const hit = h.memberships.filter((m) => m.orgId === args.where.orgId && m.userId === args.where.userId);
        for (const m of hit) m.liveSeenAt = args.data.liveSeenAt;
        return { count: hit.length };
      },
    },
  }),
}));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: async (slug: string) => (slug === "acme" ? "org-acme" : null) }));

import { getLiveSeenAt, markLiveSeen } from "./live-seen";

beforeEach(() => {
  h.updates = [];
  h.memberships = [
    { orgId: "org-acme", userId: "u-alice", liveSeenAt: null },
    { orgId: "org-acme", userId: "u-bob", liveSeenAt: new Date("2026-09-17T08:00:00Z") },
  ];
});

describe("the live ledger anchor", () => {
  it("reads a never-looked member as seenAt null, and a looked one as an ISO string", async () => {
    expect(await getLiveSeenAt("acme", "Alice")).toEqual({ seenAt: null });
    expect(await getLiveSeenAt("acme", "bob")).toEqual({ seenAt: "2026-09-17T08:00:00.000Z" });
  });

  it("answers null when there is no membership to read", async () => {
    expect(await getLiveSeenAt("acme", "mallory")).toBeNull();
    expect(await getLiveSeenAt("other", "alice")).toBeNull();
  });

  it("stamps exactly the caller's row and leaves every other member's anchor alone", async () => {
    const at = new Date("2026-09-18T12:00:00Z");
    expect(await markLiveSeen("acme", "alice", at)).toBe(true);
    expect(h.updates).toEqual([{ where: { orgId: "org-acme", userId: "u-alice" }, data: { liveSeenAt: at } }]);
    expect(h.memberships.find((m) => m.userId === "u-bob")?.liveSeenAt?.toISOString()).toBe("2026-09-17T08:00:00.000Z");
  });

  it("stamps nothing for an unknown user or org", async () => {
    expect(await markLiveSeen("acme", "mallory")).toBe(false);
    expect(await markLiveSeen("other", "alice")).toBe(false);
    expect(h.updates).toEqual([]);
  });
});
