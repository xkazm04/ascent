// The lineage read behind the Memory card's v{n} badge (challenge-2026-09-23b, org-memory#B). Before,
// `includeSuperseded` had no caller, so the badge said "this superseded an earlier one" and no surface
// could show which. getOrgMemoryLineage walks the `supersededBy` pointer backwards inside the row's org,
// newest first, within the viewer's visibility: another author's private predecessor is COUNTED
// (lineageHidden) rather than silently dropped, and never returned.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import { getOrgMemoryLineage } from "@/lib/db/org-memory";

type Row = {
  id: string;
  orgId: string;
  supersededBy: string | null;
  visibility: string;
  createdBy: string | null;
  content: string;
  updatedAt: Date;
};

function mem(id: string, supersededBy: string | null, over: Partial<Row> = {}): Row {
  return {
    id,
    orgId: "org_acme",
    supersededBy,
    visibility: "shared",
    createdBy: "alice",
    content: `content of ${id}`,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

function full(r: Row) {
  return {
    namespace: null,
    kind: "semantic",
    source: null,
    confidence: 1,
    tags: "[]",
    version: 1,
    accessCount: 0,
    citedCount: 0,
    notUsefulCount: 0,
    expiresAt: null,
    origin: "hosted",
    registryPath: null,
    archived: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...r,
  };
}

function fakePrisma(rows: Row[]) {
  const orgMemory = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const r = rows.find((x) => x.id === where.id);
      return r ? { orgId: r.orgId } : null;
    }),
    findMany: vi.fn(async ({ where }: { where: { orgId: string; supersededBy: { in: string[] } } }) =>
      rows
        .filter((r) => r.orgId === where.orgId && r.supersededBy && where.supersededBy.in.includes(r.supersededBy))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map(full),
    ),
  };
  return { orgMemory };
}

beforeEach(() => vi.clearAllMocks());

describe("getOrgMemoryLineage", () => {
  it("walks m3 <- m2 <- m1 newest first, each with content, createdBy and updatedAt", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        mem("m3", null, { updatedAt: new Date("2026-03-01T00:00:00Z") }),
        mem("m2", "m3", { createdBy: "bob", updatedAt: new Date("2026-02-01T00:00:00Z") }),
        mem("m1", "m2", { updatedAt: new Date("2026-01-01T00:00:00Z") }),
      ]),
    );
    const out = await getOrgMemoryLineage("m3", "carol");
    expect(out.lineage.map((r) => r.id)).toEqual(["m2", "m1"]);
    expect(out.lineage[0]).toMatchObject({
      content: "content of m2",
      createdBy: "bob",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(out.lineageHidden).toBe(0);
  });

  it("leaves out another author's PRIVATE predecessor and counts it, but keeps walking past it", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        mem("m3", null),
        mem("m2", "m3", { visibility: "private", createdBy: "bob" }),
        mem("m1", "m2"),
      ]),
    );
    const out = await getOrgMemoryLineage("m3", "carol");
    expect(out.lineage.map((r) => r.id)).toEqual(["m1"]);
    expect(out.lineageHidden).toBe(1);
  });

  it("shows the viewer their OWN private predecessor", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma([mem("m2", null), mem("m1", "m2", { visibility: "private", createdBy: "carol" })]),
    );
    const out = await getOrgMemoryLineage("m2", "carol");
    expect(out.lineage.map((r) => r.id)).toEqual(["m1"]);
    expect(out.lineageHidden).toBe(0);
  });

  it("never follows a pointer into another org", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([mem("m2", null), mem("x1", "m2", { orgId: "org_evil" })]));
    const out = await getOrgMemoryLineage("m2", "carol");
    expect(out.lineage).toEqual([]);
  });

  it("returns every member of a reflection merge (several rows point at one summary)", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([mem("s", null), mem("a", "s"), mem("b", "s")]));
    const out = await getOrgMemoryLineage("s", "carol");
    expect(out.lineage.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("is bounded: a long chain stops at the cap instead of walking the whole store", async () => {
    const rows = [mem("n0", null)];
    for (let i = 1; i <= 80; i++) rows.push(mem(`n${i}`, `n${i - 1}`));
    mockGetPrisma.mockReturnValue(fakePrisma(rows));
    const out = await getOrgMemoryLineage("n0", "carol");
    expect(out.lineage.length).toBeLessThanOrEqual(50);
    expect(out.lineage[0]!.id).toBe("n1");
  });

  it("returns an empty lineage for an unknown id", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([]));
    expect(await getOrgMemoryLineage("nope", "carol")).toEqual({ lineage: [], lineageHidden: 0 });
  });
});
