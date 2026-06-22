// Unit tests for the Org Skills Library db layer (Feature 2). The Prisma client is mocked; a fakePrisma
// captures the query shapes so we pin the behaviour nothing else covers:
//   - listOrgSkills builds the right where (orgId + archived:false + optional category + search OR) and
//     orderBy (name | recent | downloads);
//   - createOrgSkill bounds/normalizes its inputs;
//   - recordSkillDownload bumps BOTH the rolling tally AND the denormalized downloadCount (the sort key
//     must not drift from the tally);
//   - adoptOrgSkill enforces the org tenant boundary (a skill owned by another org can't be adopted).

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import {
  adoptOrgSkill,
  createOrgSkill,
  listOrgSkills,
  recordSkillDownload,
} from "@/lib/db/org-skills";

function fakePrisma(opts: {
  slugToId?: Record<string, string>;
  skills?: { id: string; name: string; orgId: string }[];
  findManyRows?: unknown[];
} = {}) {
  const slugToId = opts.slugToId ?? { acme: "org_acme" };
  const calls = {
    findMany: [] as { where: Record<string, unknown>; orderBy: Record<string, unknown> }[],
    create: [] as { data: Record<string, unknown> }[],
    adoptionUpsert: [] as unknown[],
    downloadUpsert: [] as unknown[],
    skillUpdate: [] as unknown[],
  };
  const prisma = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        const id = slugToId[where.slug];
        return id ? { id } : null;
      }),
      upsert: vi.fn(async ({ where }: { where: { slug: string } }) => ({ id: slugToId[where.slug] ?? "org_new" })),
    },
    orgSkill: {
      findMany: vi.fn(async (args: { where: Record<string, unknown>; orderBy: Record<string, unknown> }) => {
        calls.findMany.push({ where: args.where, orderBy: args.orderBy });
        return (opts.findManyRows ?? []) as never[];
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        calls.create.push({ data: args.data });
        return { id: "skill_new" };
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; orgId: string } }) => {
        const s = (opts.skills ?? []).find((x) => x.id === where.id && x.orgId === where.orgId);
        return s ? { id: s.id } : null;
      }),
      update: vi.fn(async (args: unknown) => {
        calls.skillUpdate.push(args);
        return { id: "x" };
      }),
    },
    orgSkillAdoption: {
      upsert: vi.fn(async (args: unknown) => {
        calls.adoptionUpsert.push(args);
        return { id: "ad" };
      }),
    },
    orgSkillDownload: {
      upsert: vi.fn(async (args: unknown) => {
        calls.downloadUpsert.push(args);
        return { id: "dl" };
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma, calls };
}

beforeEach(() => vi.clearAllMocks());

describe("listOrgSkills — where + orderBy", () => {
  it("always scopes to orgId + archived:false and defaults to recent (updatedAt desc)", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await listOrgSkills("acme");
    expect(calls.findMany[0].where).toMatchObject({ orgId: "org_acme", archived: false });
    expect(calls.findMany[0].orderBy).toEqual({ updatedAt: "desc" });
  });

  it("adds the category filter only for a valid category", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await listOrgSkills("acme", { category: "security" });
    expect(calls.findMany[0].where.category).toBe("security");

    calls.findMany.length = 0;
    await listOrgSkills("acme", { category: "bogus" });
    expect(calls.findMany[0].where.category).toBeUndefined();
  });

  it("adds a case-insensitive name/description OR for a search term", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await listOrgSkills("acme", { search: "  deploy  " });
    expect(calls.findMany[0].where.OR).toEqual([
      { name: { contains: "deploy", mode: "insensitive" } },
      { description: { contains: "deploy", mode: "insensitive" } },
    ]);
  });

  it("maps each sort to the right orderBy", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await listOrgSkills("acme", { sort: "name" });
    await listOrgSkills("acme", { sort: "downloads" });
    expect(calls.findMany[0].orderBy).toEqual({ name: "asc" });
    expect(calls.findMany[1].orderBy).toEqual({ downloadCount: "desc" });
  });

  it("returns [] for an unknown org (no findMany)", async () => {
    const { prisma, calls } = fakePrisma({ slugToId: {} });
    mockGetPrisma.mockReturnValue(prisma);
    expect(await listOrgSkills("ghost")).toEqual([]);
    expect(calls.findMany).toHaveLength(0);
  });
});

describe("createOrgSkill — bounds + normalizes", () => {
  it("caps name (200) / description (1000) / content (50k) and normalizes a bad category to 'other'", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await createOrgSkill("acme", {
      name: "n".repeat(300),
      category: "not-real",
      description: "d".repeat(2000),
      content: "c".repeat(60_000),
      tags: ["  a  ", "", "b"],
    });
    const data = calls.create[0].data as Record<string, string>;
    expect((data.name as string).length).toBe(200);
    expect((data.description as string).length).toBe(1000);
    expect((data.content as string).length).toBe(50_000);
    expect(data.category).toBe("other");
    expect(JSON.parse(data.tags as string)).toEqual(["a", "b"]);
  });
});

describe("recordSkillDownload — dual increment", () => {
  it("bumps the rolling tally AND the denormalized downloadCount in one transaction", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await recordSkillDownload("skill_1");
    expect(calls.downloadUpsert).toHaveLength(1);
    expect(calls.skillUpdate).toHaveLength(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // the tally upsert keys on skillId (single-field @@unique)
    expect((calls.downloadUpsert[0] as { where: { skillId: string } }).where.skillId).toBe("skill_1");
    // the denormalized bump increments downloadCount
    expect((calls.skillUpdate[0] as { data: { downloadCount: unknown } }).data.downloadCount).toEqual({ increment: 1 });
  });

  it("swallows errors (best-effort counter never throws)", async () => {
    const { prisma } = fakePrisma();
    prisma.$transaction.mockRejectedValueOnce(new Error("boom"));
    mockGetPrisma.mockReturnValue(prisma);
    await expect(recordSkillDownload("skill_1")).resolves.toBeUndefined();
  });
});

describe("adoptOrgSkill — org tenant boundary", () => {
  it("upserts when the skill belongs to the caller's org", async () => {
    const { prisma, calls } = fakePrisma({ skills: [{ id: "s1", name: "x", orgId: "org_acme" }] });
    mockGetPrisma.mockReturnValue(prisma);
    expect(await adoptOrgSkill("acme", "s1", "acme/repo", "alice")).toBe(true);
    expect(calls.adoptionUpsert).toHaveLength(1);
  });

  it("refuses (false, no write) when the skill is owned by another org", async () => {
    const { prisma, calls } = fakePrisma({
      slugToId: { acme: "org_acme" },
      skills: [{ id: "s1", name: "x", orgId: "org_other" }],
    });
    mockGetPrisma.mockReturnValue(prisma);
    expect(await adoptOrgSkill("acme", "s1", "acme/repo", "alice")).toBe(false);
    expect(calls.adoptionUpsert).toHaveLength(0);
  });
});
