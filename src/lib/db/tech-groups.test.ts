// Unit tests for the tech-group db layer (Feature 3b). Prisma is mocked; a fakePrisma captures the
// reconciliation so we pin:
//   - syncTechStackGroups upserts a group per derived key and reconciles memberships (ADD new, REMOVE
//     stale) when a repo re-stacks;
//   - it's a no-op for a null stack (a reconstructed snapshot must not wipe memberships);
//   - listTechStackGroups hides empty groups and sorts frontend → backend → mobile → …;
//   - techGroupScope's where-fragment shape (the tenant-safe filter).

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import { syncTechStackGroups, listTechStackGroups } from "@/lib/db/tech-groups";
import { techGroupScope } from "@/lib/db/org-shared";
import type { TechStack } from "@/lib/types";

const stack = (over: Partial<TechStack>): TechStack => ({ languages: [], frameworks: [], roles: [], confidence: 1, ...over });

function fakePrisma(opts: {
  groupIdByKey?: Record<string, string>;
  existingMembers?: { id: string; groupId: string }[];
  listGroups?: { id: string; key: string; label: string; members: number }[];
} = {}) {
  const groupIdByKey = opts.groupIdByKey ?? {};
  const calls = {
    upserts: [] as { where: { orgId_key: { orgId: string; key: string } } }[],
    deleteMany: [] as unknown[],
    createMany: [] as { data: { groupId: string; repoId: string }[] }[],
  };
  const prisma = {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1" })) },
    techStackGroup: {
      upsert: vi.fn(async (args: { where: { orgId_key: { orgId: string; key: string } } }) => {
        calls.upserts.push(args);
        return { id: groupIdByKey[args.where.orgId_key.key] ?? `grp_${args.where.orgId_key.key}` };
      }),
      findMany: vi.fn(async () =>
        (opts.listGroups ?? []).map((g) => ({ id: g.id, key: g.key, label: g.label, _count: { members: g.members } })),
      ),
    },
    techStackGroupMember: {
      findMany: vi.fn(async () => opts.existingMembers ?? []),
      deleteMany: vi.fn(async (args: unknown) => {
        calls.deleteMany.push(args);
        return { count: 1 };
      }),
      createMany: vi.fn(async (args: { data: { groupId: string; repoId: string }[] }) => {
        calls.createMany.push(args);
        return { count: args.data.length };
      }),
    },
  };
  return { prisma, calls };
}

beforeEach(() => vi.clearAllMocks());

describe("syncTechStackGroups", () => {
  it("upserts a group per derived key and adds the new memberships", async () => {
    const { prisma, calls } = fakePrisma({ groupIdByKey: { frontend: "g_fe", "backend:node": "g_be" } });
    mockGetPrisma.mockReturnValue(prisma);
    await syncTechStackGroups("org_1", "repo_1", stack({ roles: ["frontend", "backend"], backendLanguage: "Node" }));
    expect(calls.upserts.map((u) => u.where.orgId_key.key)).toEqual(["frontend", "backend:node"]);
    const added = calls.createMany[0].data.map((d) => d.groupId).sort();
    expect(added).toEqual(["g_be", "g_fe"]);
  });

  it("removes stale memberships when a repo re-stacks (was frontend+backend, now backend only)", async () => {
    const { prisma, calls } = fakePrisma({
      groupIdByKey: { "backend:node": "g_be" },
      existingMembers: [
        { id: "m_fe", groupId: "g_fe" }, // stale — no longer a desired group
        { id: "m_be", groupId: "g_be" }, // still desired
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);
    await syncTechStackGroups("org_1", "repo_1", stack({ roles: ["backend"], backendLanguage: "Node" }));
    // the stale frontend membership is deleted; the still-present backend one is NOT re-created
    expect(calls.deleteMany[0]).toMatchObject({ where: { id: { in: ["m_fe"] } } });
    expect(calls.createMany).toHaveLength(0);
  });

  it("is a no-op for a null stack (does not wipe memberships)", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await syncTechStackGroups("org_1", "repo_1", null);
    expect(calls.upserts).toHaveLength(0);
    expect(calls.deleteMany).toHaveLength(0);
  });
});

describe("listTechStackGroups", () => {
  it("hides empty groups and sorts frontend → backend → mobile", async () => {
    const { prisma } = fakePrisma({
      listGroups: [
        { id: "g3", key: "mobile", label: "Mobile", members: 1 },
        { id: "g0", key: "library", label: "Library", members: 0 }, // empty → hidden
        { id: "g1", key: "frontend", label: "Frontend", members: 4 },
        { id: "g2", key: "backend:node", label: "Backend · Node", members: 2 },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);
    const out = await listTechStackGroups("acme");
    expect(out.map((g) => g.key)).toEqual(["frontend", "backend:node", "mobile"]);
    expect(out.every((g) => g.repoCount > 0)).toBe(true);
  });
});

describe("techGroupScope", () => {
  it("filters repos by tech-group membership; empty when no group", () => {
    expect(techGroupScope("g_1")).toEqual({ techGroups: { some: { groupId: "g_1" } } });
    expect(techGroupScope(null)).toEqual({});
    expect(techGroupScope(undefined)).toEqual({});
  });
});
