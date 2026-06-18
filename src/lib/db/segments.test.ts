import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildSegmentComparison,
  compareSegments,
  normalizeColor,
  normalizeSegmentName,
  setRepoSegment,
  setRepoSegmentsBulk,
  type SegmentSummary,
} from "@/lib/db/segments";
import { segmentScope } from "@/lib/db/org-shared";

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

// ── Segment-scoped rollup actually filters to the segment's repos (CRITICAL #2) ───────────────────
//
// Every per-segment number on the comparison page is a getOrgRollup() scoped by seg.id:
//   compareSegments → summarizeSegment(orgSlug, seg) → getOrgRollup(orgSlug, undefined, seg.id)
//     → segmentScope(seg.id) → { segments: { some: { segmentId } } } spread into the repo query.
// If segmentScope ever returns {} for a non-null id, or getOrgRollup stops forwarding the id, EVERY
// segment silently reports the whole-fleet average and the comparison shows two identical columns
// with a zero delta — "platform and legacy are equally mature." That is the exact comparison theater
// the feature exists to disprove, and it would ship green without these tests. We pin the wiring two
// ways: (1) segmentScope's literal Prisma fragment, and (2) the end-to-end query the rollup issues,
// asserting a non-null id NARROWS the repo set (and two different segments narrow to DIFFERENT sets).

describe("segmentScope — the Prisma where-fragment that scopes a rollup to one segment", () => {
  it("returns an EMPTY fragment for a null/undefined id (rollup stays fleet-wide)", () => {
    expect(segmentScope(null)).toEqual({});
    expect(segmentScope(undefined)).toEqual({});
    expect(segmentScope()).toEqual({});
  });

  it("returns { segments: { some: { segmentId } } } for a real id — the narrowing filter", () => {
    expect(segmentScope("s1")).toEqual({ segments: { some: { segmentId: "s1" } } });
    // The id is threaded through verbatim — a different segment narrows to a DIFFERENT set.
    expect(segmentScope("s2")).toEqual({ segments: { some: { segmentId: "s2" } } });
    expect(segmentScope("s1")).not.toEqual(segmentScope("s2"));
  });
});

// A fakePrisma that drives the REAL getOrgRollup (imported live by summarizeSegment) so we observe
// the actual scoped query, not a hand-built summary. `reposBySegment[segmentId]` is the repo set
// tagged into that segment; the unscoped key "" is the whole fleet. `repository.findMany` reads the
// `segments.some.segmentId` out of the supplied where and returns ONLY that segment's repos — exactly
// like the join the real query performs — so an unscoped regression (no segmentId in the where) would
// fall through to the whole fleet and the assertions below would catch it.
function rollupPrisma(opts: {
  orgSlug: string;
  orgId: string;
  segments: { id: string; name: string }[];
  // segmentId → repos in it; "" (empty key) → the whole fleet. Each repo carries its latest scan.
  reposBySegment: Record<string, { id: string; fullName: string; overall: number; adoption: number; rigor: number }[]>;
}) {
  const repoQueries: Array<{ segmentId: string | undefined; where: Record<string, unknown> }> = [];
  const scanQueries: Array<{ segmentId: string | undefined; where: Record<string, unknown> }> = [];

  const segIdOf = (seg: unknown): string | undefined => {
    const s = seg as { some?: { segmentId?: string } } | undefined;
    return s?.some?.segmentId;
  };
  const reposFor = (segmentId: string | undefined) => opts.reposBySegment[segmentId ?? ""] ?? [];

  const repoRow = (r: { id: string; fullName: string; overall: number; adoption: number; rigor: number }) => ({
    id: r.id,
    fullName: r.fullName,
    owner: r.fullName.split("/")[0],
    name: r.fullName.split("/")[1],
    isPrivate: false,
    watched: true,
    primaryLanguage: "TypeScript",
    scanSchedule: "weekly",
    lastScanAt: null,
    lastScanStatus: "ok",
    lastScanError: null,
    aiConformance: null,
    scans: [
      {
        level: "L3",
        overallScore: r.overall,
        adoptionScore: r.adoption,
        rigorScore: r.rigor,
        posture: "ai-native",
        scannedAt: new Date("2026-01-01T00:00:00Z"),
        dimensions: [{ dimId: "D1", score: r.overall }],
      },
    ],
  });

  const prisma = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) =>
        where.slug === opts.orgSlug ? { id: opts.orgId } : null,
      ),
    },
    segment: {
      findMany: vi.fn(async ({ where }: { where: { orgId: string; id: { in: string[] } } }) =>
        where.orgId === opts.orgId
          ? opts.segments.filter((s) => where.id.in.includes(s.id)).map((s) => ({ id: s.id, name: s.name }))
          : [],
      ),
    },
    repository: {
      findMany: vi.fn(async ({ where }: { where: { orgId: string; segments?: unknown } }) => {
        const segmentId = segIdOf(where.segments);
        repoQueries.push({ segmentId, where });
        if (where.orgId !== opts.orgId) return [];
        return reposFor(segmentId).map(repoRow);
      }),
    },
    scan: {
      findMany: vi.fn(async ({ where }: { where: { repo?: { orgId?: string; segments?: unknown } } }) => {
        const segmentId = segIdOf(where.repo?.segments);
        scanQueries.push({ segmentId, where });
        return reposFor(segmentId).map((r) => ({
          scannedAt: new Date("2026-01-01T00:00:00Z"),
          overallScore: r.overall,
        }));
      }),
    },
  };
  return { prisma, repoQueries, scanQueries };
}

describe("summarizeSegment scope — the segment rollup must filter to the segment's repos", () => {
  // platform = two strong repos; legacy = one weak repo; the fleet ("") = all three.
  const FLEET = [
    { id: "r1", fullName: "acme/platform-a", overall: 90, adoption: 88, rigor: 92 },
    { id: "r2", fullName: "acme/platform-b", overall: 84, adoption: 80, rigor: 88 },
    { id: "r3", fullName: "acme/legacy-a", overall: 30, adoption: 20, rigor: 40 },
  ];
  const PLATFORM = [FLEET[0]!, FLEET[1]!];
  const LEGACY = [FLEET[2]!];

  function harness(reposBySegment: Record<string, typeof FLEET>) {
    const rp = rollupPrisma({
      orgSlug: "acme",
      orgId: "org_acme",
      segments: [
        { id: "platform", name: "Platform" },
        { id: "legacy", name: "Legacy" },
      ],
      reposBySegment,
    });
    mockGetPrisma.mockReturnValue(rp.prisma);
    return rp;
  }

  it("threads the segment id into the repo query as { segments: { some: { segmentId } } }", async () => {
    const rp = harness({ "": FLEET, platform: PLATFORM, legacy: LEGACY });

    // Compare a single segment against the whole fleet (bId = null).
    const cmp = await compareSegments("acme", "platform", null);
    expect(cmp).not.toBeNull();

    // The SEGMENT side issued a repo query narrowed to platform; the FLEET side issued an unscoped one.
    const scopedSegmentIds = rp.repoQueries.map((q) => q.segmentId);
    expect(scopedSegmentIds).toContain("platform"); // segment side narrowed
    expect(scopedSegmentIds).toContain(undefined); // fleet side (id=null) NOT narrowed
    const platformQuery = rp.repoQueries.find((q) => q.segmentId === "platform")!;
    expect(platformQuery.where).toMatchObject({ orgId: "org_acme", segments: { some: { segmentId: "platform" } } });
    // The fleet-side query carries no `segments` key at all.
    const fleetQuery = rp.repoQueries.find((q) => q.segmentId === undefined)!;
    expect(fleetQuery.where).not.toHaveProperty("segments");
  });

  it("a segment reports ITS repos' average, not the whole fleet's (single-segment vs fleet)", async () => {
    harness({ "": FLEET, platform: PLATFORM, legacy: LEGACY });

    const cmp = await compareSegments("acme", "platform", null);
    expect(cmp).not.toBeNull();
    // a = platform segment (2 strong repos, avg 87); b = whole fleet (3 repos, avg 68).
    expect(cmp!.a.id).toBe("platform");
    expect(cmp!.a.repoCount).toBe(2);
    expect(cmp!.a.avgOverall).toBe(Math.round((90 + 84) / 2)); // 87
    expect(cmp!.b.id).toBeNull(); // the fleet baseline
    expect(cmp!.b.repoCount).toBe(3);
    expect(cmp!.b.avgOverall).toBe(Math.round((90 + 84 + 30) / 3)); // 68
    // The segment is measurably above the fleet — NOT the identical-column theater.
    expect(cmp!.deltas.overall).toBe(87 - 68);
    expect(cmp!.deltas.overall).not.toBe(0);
  });

  it("ANTI-COMPARISON-THEATER: two different segments produce DIFFERENT scoped inputs → different columns", async () => {
    const rp = harness({ "": FLEET, platform: PLATFORM, legacy: LEGACY });

    const cmp = await compareSegments("acme", "platform", "legacy");
    expect(cmp).not.toBeNull();

    // Each side narrowed to its OWN segment id — the two repo queries are distinct, not both fleet.
    const ids = rp.repoQueries.map((q) => q.segmentId).filter(Boolean);
    expect(ids).toContain("platform");
    expect(ids).toContain("legacy");
    expect(rp.repoQueries.every((q) => q.segmentId !== undefined)).toBe(true); // neither side is fleet-wide

    // Different repo sets → genuinely different averages → a non-zero delta (the whole point).
    expect(cmp!.a.avgOverall).toBe(87); // platform
    expect(cmp!.b.avgOverall).toBe(30); // legacy
    expect(cmp!.a.avgOverall).not.toBe(cmp!.b.avgOverall);
    expect(cmp!.deltas.overall).toBe(57);
    expect(cmp!.deltas.overall).not.toBe(0);
  });

  it("an empty segment yields a ZERO rollup, not the whole-fleet average", async () => {
    // platform has repos; legacy is tagged into nothing → its scoped query returns [].
    harness({ "": FLEET, platform: PLATFORM, legacy: [] });

    const cmp = await compareSegments("acme", "platform", "legacy");
    expect(cmp).not.toBeNull();
    // The empty segment did NOT silently fall back to the 3-repo fleet (avg 68).
    expect(cmp!.b.id).toBe("legacy");
    expect(cmp!.b.repoCount).toBe(0);
    expect(cmp!.b.scannedCount).toBe(0);
    expect(cmp!.b.avgOverall).toBe(0);
    // Platform is intact, so the comparison is a real gap (87 vs 0), not theater.
    expect(cmp!.a.avgOverall).toBe(87);
    expect(cmp!.deltas.overall).toBe(87);
  });
});
