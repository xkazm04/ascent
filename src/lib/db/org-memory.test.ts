// Unit tests for the Shared Org Memory db layer (Memory-as-a-Service MVP). The Prisma client is mocked;
// a fakePrisma captures the query shapes so we pin the behaviour nothing else covers:
//   - listOrgMemories always scopes to orgId + archived:false, DROPS superseded rows, and AND-composes
//     the TTL + visibility (+ search) fragments — the design doc's §4.5/§7.4/§8 read rules;
//   - private scratch is visible only to its author (and never to an anonymous viewer);
//   - createOrgMemory bounds/normalizes inputs and stores a blank namespace as NULL;
//   - the supersede write is ATOMIC and org-scoped: a target in another org rolls the whole write back
//     (SupersedeTargetNotFoundError) instead of committing a correction that corrected nothing;
//   - candidateOrgMemories bounds the LLM input and compares org-wide memories against org-wide ones.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import {
  SupersedeTargetNotFoundError,
  candidateOrgMemories,
  createOrgMemory,
  listOrgMemories,
  recordMemoryRecall,
} from "@/lib/db/org-memory";

type Where = Record<string, unknown>;

function fakePrisma(
  opts: {
    slugToId?: Record<string, string>;
    /** Memories that exist, for the supersede-target lookup. */
    memories?: { id: string; orgId: string; version: number }[];
    /** What updateMany reports having stamped (0 simulates a lost race). */
    updateManyCount?: number;
  } = {},
) {
  const slugToId = opts.slugToId ?? { acme: "org_acme" };
  const calls = {
    findMany: [] as { where: Where; orderBy?: unknown; take?: number }[],
    create: [] as { data: Record<string, unknown> }[],
    updateMany: [] as { where: Where; data: Where }[],
    update: [] as unknown[],
  };
  const orgMemory = {
    findMany: vi.fn(async (args: { where: Where; orderBy?: unknown; take?: number }) => {
      calls.findMany.push({ where: args.where, orderBy: args.orderBy, take: args.take });
      return [] as never[];
    }),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      calls.create.push({ data: args.data });
      return { id: "mem_new" };
    }),
    findFirst: vi.fn(async ({ where }: { where: { id: string; orgId: string } }) => {
      const m = (opts.memories ?? []).find((x) => x.id === where.id && x.orgId === where.orgId);
      return m ? { version: m.version } : null;
    }),
    updateMany: vi.fn(async (args: { where: Where; data: Where }) => {
      calls.updateMany.push(args);
      return { count: opts.updateManyCount ?? 1 };
    }),
    update: vi.fn(async (args: unknown) => {
      calls.update.push(args);
      return { id: "x" };
    }),
  };
  const prisma = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        const id = slugToId[where.slug];
        return id ? { id } : null;
      }),
      upsert: vi.fn(async ({ where }: { where: { slug: string } }) => ({
        id: slugToId[where.slug] ?? "org_new",
      })),
    },
    orgMemory,
    // Interactive transaction: hand the callback a tx that is the same mocked model surface, and let a
    // throw inside it propagate (that IS the rollback the real client performs).
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ orgMemory })),
  };
  return { prisma, calls };
}

/** Pull the AND-composed fragments listOrgMemories builds, for assertions. */
const andOf = (where: Where) => (where.AND ?? []) as Record<string, unknown>[];

beforeEach(() => vi.clearAllMocks());

describe("listOrgMemories — the read rules", () => {
  it("scopes to orgId + archived:false, drops superseded rows, defaults to recent", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await listOrgMemories("acme");
    const w = calls.findMany[0]!.where;
    expect(w).toMatchObject({ orgId: "org_acme", archived: false, supersededBy: null });
    expect(calls.findMany[0]!.orderBy).toEqual([{ updatedAt: "desc" }]);
  });

  it("includes superseded rows only when asked (the lineage view)", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await listOrgMemories("acme", { includeSuperseded: true });
    expect(calls.findMany[0]!.where.supersededBy).toBeUndefined();
  });

  it("always AND-composes the TTL fragment (null OR in the future)", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await listOrgMemories("acme");
    const ttl = andOf(calls.findMany[0]!.where)[0] as { OR: unknown[] };
    expect(ttl.OR[0]).toEqual({ expiresAt: null });
    expect(ttl.OR[1]).toHaveProperty("expiresAt.gt");
  });

  it("shows a viewer shared memories plus their OWN private scratch", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await listOrgMemories("acme", {}, "alice");
    expect(andOf(calls.findMany[0]!.where)[1]).toEqual({
      OR: [{ visibility: "shared" }, { visibility: "private", createdBy: "alice" }],
    });
  });

  it("shows an anonymous viewer ONLY shared memories (never another author's scratch)", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await listOrgMemories("acme", {}, null);
    expect(andOf(calls.findMany[0]!.where)[1]).toEqual({ visibility: "shared" });
  });

  it("adds a case-insensitive content/source/namespace OR for a search term", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await listOrgMemories("acme", { search: "  auth  " });
    const search = andOf(calls.findMany[0]!.where)[2] as { OR: unknown[] };
    expect(search.OR).toEqual([
      { content: { contains: "auth", mode: "insensitive" } },
      { source: { contains: "auth", mode: "insensitive" } },
      { namespace: { contains: "auth", mode: "insensitive" } },
    ]);
  });

  it("adds the kind filter only for a valid kind", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await listOrgMemories("acme", { kind: "procedural" });
    expect(calls.findMany[0]!.where.kind).toBe("procedural");

    calls.findMany.length = 0;
    await listOrgMemories("acme", { kind: "bogus" });
    expect(calls.findMany[0]!.where.kind).toBeUndefined();
  });

  it("maps each sort to the right orderBy and caps the page size", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await listOrgMemories("acme", { sort: "confidence" });
    await listOrgMemories("acme", { sort: "recalls" });
    await listOrgMemories("acme", { limit: 9999 });
    expect(calls.findMany[0]!.orderBy).toEqual([{ confidence: "desc" }, { updatedAt: "desc" }]);
    expect(calls.findMany[1]!.orderBy).toEqual([{ accessCount: "desc" }, { updatedAt: "desc" }]);
    expect(calls.findMany[2]!.take).toBe(500);
  });

  it("returns [] for an unknown org (no findMany) — a bogus slug looks like an empty one", async () => {
    const { prisma, calls } = fakePrisma({ slugToId: {} });
    mockGetPrisma.mockReturnValue(prisma);
    expect(await listOrgMemories("ghost")).toEqual([]);
    expect(calls.findMany).toHaveLength(0);
  });
});

describe("createOrgMemory — bounds + normalizes", () => {
  it("caps content (20k), normalizes a bad kind/visibility, clamps confidence, cleans tags", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await createOrgMemory("acme", {
      content: "c".repeat(30_000),
      kind: "not-real",
      visibility: "world",
      confidence: 7.5,
      tags: ["  a  ", "", "b"],
    });
    const data = calls.create[0]!.data as Record<string, unknown>;
    expect((data.content as string).length).toBe(20_000);
    expect(data.kind).toBe("semantic");
    expect(data.visibility).toBe("shared");
    expect(data.confidence).toBe(1);
    expect(JSON.parse(data.tags as string)).toEqual(["a", "b"]);
    expect(data.version).toBe(1);
  });

  it("stores a blank namespace as NULL (org-wide), not an empty string", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await createOrgMemory("acme", { content: "x", namespace: "   " });
    expect(calls.create[0]!.data.namespace).toBeNull();

    calls.create.length = 0;
    await createOrgMemory("acme", { content: "x", namespace: " backend " });
    expect(calls.create[0]!.data.namespace).toBe("backend");
  });
});

describe("createOrgMemory — supersede (versioning + tenant boundary)", () => {
  it("stamps the target with the new id and inherits version+1", async () => {
    const { prisma, calls } = fakePrisma({
      memories: [{ id: "mem_old", orgId: "org_acme", version: 3 }],
    });
    mockGetPrisma.mockReturnValue(prisma);
    const created = await createOrgMemory("acme", { content: "corrected", supersedeId: "mem_old" });

    expect(created).toEqual({ id: "mem_new" });
    expect(calls.create[0]!.data.version).toBe(4);
    expect(calls.updateMany[0]!.where).toMatchObject({ id: "mem_old", orgId: "org_acme", supersededBy: null });
    expect(calls.updateMany[0]!.data).toEqual({ supersededBy: "mem_new" });
  });

  it("REFUSES a supersede target owned by another org (rolls back, writes nothing)", async () => {
    const { prisma, calls } = fakePrisma({
      slugToId: { acme: "org_acme" },
      memories: [{ id: "mem_other", orgId: "org_evil", version: 1 }],
    });
    mockGetPrisma.mockReturnValue(prisma);
    await expect(
      createOrgMemory("acme", { content: "x", supersedeId: "mem_other" }),
    ).rejects.toBeInstanceOf(SupersedeTargetNotFoundError);
    // The guard runs BEFORE the create, so no row is written and nothing is stamped.
    expect(calls.create).toHaveLength(0);
    expect(calls.updateMany).toHaveLength(0);
  });

  it("aborts when the target was already superseded by a racing corrector (count === 0)", async () => {
    const { prisma } = fakePrisma({
      memories: [{ id: "mem_old", orgId: "org_acme", version: 1 }],
      updateManyCount: 0,
    });
    mockGetPrisma.mockReturnValue(prisma);
    await expect(
      createOrgMemory("acme", { content: "x", supersedeId: "mem_old" }),
    ).rejects.toBeInstanceOf(SupersedeTargetNotFoundError);
  });

  it("does not open a supersede path for a plain write", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await createOrgMemory("acme", { content: "plain" });
    expect(calls.updateMany).toHaveLength(0);
    expect(prisma.orgMemory.findFirst).not.toHaveBeenCalled();
  });
});

describe("candidateOrgMemories — bounds the LLM input", () => {
  it("compares org-wide memories against org-wide ones (namespace IS NULL), not the whole store", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await candidateOrgMemories("acme", {});
    expect(calls.findMany[0]!.where.namespace).toBeNull();
  });

  it("scopes to the requested namespace and hard-caps the candidate set", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await candidateOrgMemories("acme", { namespace: "backend", limit: 9999 });
    expect(calls.findMany[0]!.where).toMatchObject({
      orgId: "org_acme",
      archived: false,
      supersededBy: null,
      namespace: "backend",
    });
    expect(calls.findMany[0]!.take).toBe(100);
  });

  it("returns [] for an unknown org", async () => {
    const { prisma } = fakePrisma({ slugToId: {} });
    mockGetPrisma.mockReturnValue(prisma);
    expect(await candidateOrgMemories("ghost", {})).toEqual([]);
  });
});

describe("recordMemoryRecall — best-effort counter", () => {
  it("increments accessCount", async () => {
    const { prisma, calls } = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await recordMemoryRecall("mem_1");
    expect((calls.update[0] as { data: { accessCount: unknown } }).data.accessCount).toEqual({ increment: 1 });
  });

  it("swallows errors (a counter must never break the read path it decorates)", async () => {
    const { prisma } = fakePrisma();
    prisma.orgMemory.update.mockRejectedValueOnce(new Error("boom"));
    mockGetPrisma.mockReturnValue(prisma);
    await expect(recordMemoryRecall("mem_1")).resolves.toBeUndefined();
  });
});
