import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildSegmentComparison,
  normalizeColor,
  normalizeSegmentName,
  setRepoSegment,
  setRepoSegmentsBulk,
  type SegmentSummary,
} from "@/lib/db/segments";

// The DB client is mocked away so the module never touches Prisma. The pure-helper tests below
// don't use it; the DB-write tests drive a fakePrisma through it (see fakePrisma()).
const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

// Pure helpers behind the segments layer (name/color sanitization + the side-by-side diff) — no DB.

describe("normalizeSegmentName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeSegmentName("  platform  ")).toBe("platform");
  });
  it("caps the length at 60 chars", () => {
    expect(normalizeSegmentName("x".repeat(80))).toHaveLength(60);
  });
});

describe("normalizeColor", () => {
  it("accepts a 6-digit hex and lowercases it", () => {
    expect(normalizeColor("#A1B2C3")).toBe("#a1b2c3");
  });
  it("accepts a 3-digit hex", () => {
    expect(normalizeColor("#abc")).toBe("#abc");
  });
  it("falls back to the brand accent for malformed or empty input", () => {
    expect(normalizeColor("red")).toBe("#3b9eff");
    expect(normalizeColor("#12")).toBe("#3b9eff");
    expect(normalizeColor("")).toBe("#3b9eff");
    expect(normalizeColor(null)).toBe("#3b9eff");
    expect(normalizeColor(undefined)).toBe("#3b9eff");
  });
});

function summary(over: Partial<SegmentSummary>): SegmentSummary {
  return {
    id: "s",
    name: "seg",
    repoCount: 0,
    scannedCount: 0,
    avgOverall: 0,
    avgAdoption: 0,
    avgRigor: 0,
    posture: "early",
    dimAverages: [],
    ...over,
  };
}

describe("buildSegmentComparison", () => {
  it("computes signed headline deltas as a − b", () => {
    const a = summary({ name: "platform", avgOverall: 80, avgAdoption: 85, avgRigor: 70 });
    const b = summary({ name: "legacy", avgOverall: 50, avgAdoption: 40, avgRigor: 60 });
    const c = buildSegmentComparison(a, b);
    expect(c.a.name).toBe("platform");
    expect(c.b.name).toBe("legacy");
    expect(c.deltas).toEqual({ overall: 30, adoption: 45, rigor: 10 });
  });

  it("unions dimensions from both sides (sorted) and treats a missing side as 0", () => {
    const a = summary({ dimAverages: [{ dimId: "D2", avg: 60 }, { dimId: "D1", avg: 90 }] });
    const b = summary({ dimAverages: [{ dimId: "D1", avg: 40 }, { dimId: "D8", avg: 30 }] });
    const c = buildSegmentComparison(a, b);
    expect(c.dimDeltas.map((d) => d.dimId)).toEqual(["D1", "D2", "D8"]);
    expect(c.dimDeltas).toContainEqual({ dimId: "D1", a: 90, b: 40, delta: 50 });
    expect(c.dimDeltas).toContainEqual({ dimId: "D2", a: 60, b: 0, delta: 60 }); // absent in b
    expect(c.dimDeltas).toContainEqual({ dimId: "D8", a: 0, b: 30, delta: -30 }); // absent in a
  });
});

// ── Cross-tenant isolation of repo tagging (CRITICAL #1) ──────────────────────────────────────────
//
// The whole tenant boundary on /api/org/segments/<id>/repos rests on the org filter INSIDE these two
// db functions: the route gates only on the client-supplied `body.org`, so the segment's true owner is
// asserted nowhere but the compound `where: { id: segmentId, orgId }` here. These tests pin that a
// member of org A passing org="A" + a segment that belongs to org B can NEVER write a RepoSegment row:
// the org-scoped findFirst returns null → setRepoSegment resolves false / setRepoSegmentsBulk returns
// -1, and the upsert/createMany/deleteMany write is never reached. If a refactor drops `orgId` from the
// segment lookup (the silent IDOR), these go red.

/**
 * A fakePrisma scoped to a single owning org. `ownerOrgId` is the org that actually owns the segment
 * and the repos; `segment.findFirst` / `repository.findUnique` / `repository.findMany` only match when
 * the supplied `where.orgId` equals it — exactly like a real per-tenant DB. `organization.findUnique`
 * (used by resolveOrgId) maps a slug → its id via `slugToId`. Every write method is a spy so we can
 * assert it was (or, for cross-tenant, was NOT) called.
 */
function fakePrisma(opts: {
  ownerOrgId: string;
  slugToId: Record<string, string>;
  repoFullNames?: string[]; // fullNames that exist under ownerOrgId
  createCount?: number;
  deleteCount?: number;
}) {
  const owned = new Set(opts.repoFullNames ?? []);
  const repoId = (fullName: string) => `repo_${fullName.replace(/[^a-z0-9]/gi, "_")}`;
  const calls = {
    segmentFindFirst: [] as Array<{ where: { id: string; orgId: string } }>,
    repoFindUnique: [] as Array<{ where: { orgId_fullName: { orgId: string; fullName: string } } }>,
    repoFindMany: [] as Array<{ where: { orgId: string; fullName: { in: string[] } } }>,
  };
  const upsert = vi.fn(async () => ({ segmentId: "x", repoId: "y" }));
  const deleteMany = vi.fn(async () => ({ count: opts.deleteCount ?? 0 }));
  const createMany = vi.fn(async () => ({ count: opts.createCount ?? 0 }));

  const prisma = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        const id = opts.slugToId[where.slug];
        return id ? { id } : null;
      }),
    },
    segment: {
      // Mirrors the real per-tenant filter: only matches when BOTH id and orgId line up.
      findFirst: vi.fn(async ({ where }: { where: { id: string; orgId: string } }) => {
        calls.segmentFindFirst.push({ where });
        return where.orgId === opts.ownerOrgId ? { id: where.id } : null;
      }),
    },
    repository: {
      findUnique: vi.fn(async ({ where }: { where: { orgId_fullName: { orgId: string; fullName: string } } }) => {
        calls.repoFindUnique.push({ where });
        const { orgId, fullName } = where.orgId_fullName;
        return orgId === opts.ownerOrgId && owned.has(fullName) ? { id: repoId(fullName) } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: { orgId: string; fullName: { in: string[] } } }) => {
        calls.repoFindMany.push({ where });
        if (where.orgId !== opts.ownerOrgId) return [];
        return where.fullName.in.filter((f) => owned.has(f)).map((f) => ({ id: repoId(f) }));
      }),
    },
    repoSegment: { upsert, deleteMany, createMany },
  };
  return { prisma, upsert, deleteMany, createMany, calls };
}

beforeEach(() => {
  mockGetPrisma.mockReset();
});

describe("setRepoSegment — org-scoped tagging boundary", () => {
  it("tags a repo only after BOTH the segment and the repo resolve under the caller's orgId", async () => {
    const fp = fakePrisma({ ownerOrgId: "orgA", slugToId: { A: "orgA" }, repoFullNames: ["acme/repo"] });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const ok = await setRepoSegment("A", "seg1", "acme/repo", true);

    expect(ok).toBe(true);
    // Both lookups carry the RESOLVED orgId — the load-bearing tenant filter.
    expect(fp.calls.segmentFindFirst[0]!.where).toMatchObject({ id: "seg1", orgId: "orgA" });
    expect(fp.calls.repoFindUnique[0]!.where.orgId_fullName).toMatchObject({ orgId: "orgA", fullName: "acme/repo" });
    expect(fp.upsert).toHaveBeenCalledTimes(1);
    expect(fp.deleteMany).not.toHaveBeenCalled();
  });

  it("untags via deleteMany on the happy path (member=false)", async () => {
    const fp = fakePrisma({ ownerOrgId: "orgA", slugToId: { A: "orgA" }, repoFullNames: ["acme/repo"] });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const ok = await setRepoSegment("A", "seg1", "acme/repo", false);

    expect(ok).toBe(true);
    expect(fp.deleteMany).toHaveBeenCalledTimes(1);
    expect(fp.upsert).not.toHaveBeenCalled();
  });

  it("CROSS-TENANT: refuses to tag another org's segment — false, no write (silent-IDOR guard)", async () => {
    // Caller is a member of org A (slug A → orgA), but "seg1" belongs to orgB. The org-scoped
    // findFirst returns null, so no RepoSegment row is ever written.
    const fp = fakePrisma({ ownerOrgId: "orgB", slugToId: { A: "orgA" }, repoFullNames: ["acme/repo"] });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const ok = await setRepoSegment("A", "seg1", "acme/repo", true);

    expect(ok).toBe(false);
    expect(fp.calls.segmentFindFirst[0]!.where).toMatchObject({ id: "seg1", orgId: "orgA" }); // filtered by caller's org
    expect(fp.upsert).not.toHaveBeenCalled();
    expect(fp.deleteMany).not.toHaveBeenCalled();
  });

  it("CROSS-TENANT: refuses to tag another org's repo — false, no write", async () => {
    // Segment belongs to the caller's org, but the repo fullName isn't owned under orgA →
    // repository.findUnique returns null → no write.
    const fp = fakePrisma({ ownerOrgId: "orgA", slugToId: { A: "orgA" }, repoFullNames: [] });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const ok = await setRepoSegment("A", "seg1", "victim/repo", true);

    expect(ok).toBe(false);
    expect(fp.calls.repoFindUnique[0]!.where.orgId_fullName).toMatchObject({ orgId: "orgA", fullName: "victim/repo" });
    expect(fp.upsert).not.toHaveBeenCalled();
  });

  it("returns false (no write) when the org slug doesn't resolve", async () => {
    const fp = fakePrisma({ ownerOrgId: "orgA", slugToId: {}, repoFullNames: ["acme/repo"] });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const ok = await setRepoSegment("ghost", "seg1", "acme/repo", true);

    expect(ok).toBe(false);
    expect(fp.calls.segmentFindFirst).toHaveLength(0); // short-circuits before the segment lookup
    expect(fp.upsert).not.toHaveBeenCalled();
  });
});

describe("setRepoSegmentsBulk — org-scoped bulk tagging boundary + count contract", () => {
  it("creates memberships with skipDuplicates and returns res.count on the happy path", async () => {
    const fp = fakePrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      repoFullNames: ["a/one", "a/two"],
      createCount: 2,
    });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const changed = await setRepoSegmentsBulk("A", "seg1", ["a/one", "a/two"], true);

    expect(changed).toBe(2);
    expect(fp.calls.segmentFindFirst[0]!.where).toMatchObject({ id: "seg1", orgId: "orgA" });
    expect(fp.calls.repoFindMany[0]!.where).toMatchObject({ orgId: "orgA" });
    expect(fp.createMany).toHaveBeenCalledTimes(1);
    expect(fp.createMany.mock.calls[0]![0]).toMatchObject({ skipDuplicates: true });
    expect(fp.deleteMany).not.toHaveBeenCalled();
  });

  it("removes via deleteMany and returns res.count on the un-tag path", async () => {
    const fp = fakePrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      repoFullNames: ["a/one"],
      deleteCount: 1,
    });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const changed = await setRepoSegmentsBulk("A", "seg1", ["a/one"], false);

    expect(changed).toBe(1);
    expect(fp.deleteMany).toHaveBeenCalledTimes(1);
    expect(fp.createMany).not.toHaveBeenCalled();
  });

  it("CROSS-TENANT: returns -1 and writes nothing for another org's segment (so the route 404s)", async () => {
    const fp = fakePrisma({ ownerOrgId: "orgB", slugToId: { A: "orgA" }, repoFullNames: ["a/one"] });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const changed = await setRepoSegmentsBulk("A", "seg1", ["a/one"], true);

    expect(changed).toBe(-1);
    expect(fp.calls.segmentFindFirst[0]!.where).toMatchObject({ id: "seg1", orgId: "orgA" });
    expect(fp.calls.repoFindMany).toHaveLength(0); // never even looks up repos
    expect(fp.createMany).not.toHaveBeenCalled();
    expect(fp.deleteMany).not.toHaveBeenCalled();
  });

  it("returns -1 (no write) when the org slug doesn't resolve", async () => {
    const fp = fakePrisma({ ownerOrgId: "orgA", slugToId: {}, repoFullNames: ["a/one"] });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const changed = await setRepoSegmentsBulk("ghost", "seg1", ["a/one"], true);

    expect(changed).toBe(-1);
    expect(fp.calls.segmentFindFirst).toHaveLength(0);
    expect(fp.createMany).not.toHaveBeenCalled();
  });

  it("returns 0 (not -1) for an empty/all-non-string selection — a valid no-op, not a 404", async () => {
    const fp = fakePrisma({ ownerOrgId: "orgA", slugToId: { A: "orgA" }, repoFullNames: ["a/one"] });
    mockGetPrisma.mockReturnValue(fp.prisma);

    expect(await setRepoSegmentsBulk("A", "seg1", [], true)).toBe(0);
    // Non-strings are dropped before the repo lookup → no repos resolve → 0, never a write.
    expect(await setRepoSegmentsBulk("A", "seg1", [null as never, 42 as never], true)).toBe(0);
    expect(fp.calls.repoFindMany).toHaveLength(0);
    expect(fp.createMany).not.toHaveBeenCalled();
  });

  it("returns 0 when none of the supplied repos belong to the org (cross-tenant fullNames ignored)", async () => {
    const fp = fakePrisma({ ownerOrgId: "orgA", slugToId: { A: "orgA" }, repoFullNames: [] });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const changed = await setRepoSegmentsBulk("A", "seg1", ["victim/repo"], true);

    expect(changed).toBe(0);
    expect(fp.calls.repoFindMany[0]!.where).toMatchObject({ orgId: "orgA" });
    expect(fp.createMany).not.toHaveBeenCalled();
  });

  it("dedups fullNames before the lookup — ['a','a','b'] queries exactly two repos", async () => {
    const fp = fakePrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      repoFullNames: ["a/one", "a/two"],
      createCount: 2,
    });
    mockGetPrisma.mockReturnValue(fp.prisma);

    await setRepoSegmentsBulk("A", "seg1", ["a/one", "a/one", "a/two"], true);

    expect(fp.calls.repoFindMany[0]!.where.fullName.in).toEqual(["a/one", "a/two"]);
  });
});
