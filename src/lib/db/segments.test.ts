import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  buildSegmentComparison,
  compareSegments,
  getRepoSegmentMap,
  normalizeColor,
  normalizeSegmentName,
  segmentInputError,
  setRepoSegment,
  setRepoSegmentsBulk,
  applySegmentRule,
  listSegmentSummaries,
  loadSegmentsView,
  resolveComparePair,
  type SegmentSummary,
} from "@/lib/db/segments";
import { segmentScope } from "@/lib/db/org-shared";
import { latestScanReads, scansOfRepoRows } from "./org-rollup-latest-scans.test-helpers";

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

// repositories-segments 2026-07-16 #5: the routes now REJECT (400) what the normalizers would have
// silently rewritten — a malformed colour became the brand accent, a 61+-char name was truncated,
// both behind a 200 { ok } that misreported the caller's value as applied.
describe("segmentInputError", () => {
  it("accepts a normal name + palette hex (and 3-digit hexes)", () => {
    expect(segmentInputError({ name: "platform", color: "#3b9eff" })).toBeNull();
    expect(segmentInputError({ name: "platform", color: "#abc" })).toBeNull();
  });
  it("accepts a partial PATCH (fields omitted are untouched)", () => {
    expect(segmentInputError({})).toBeNull();
    expect(segmentInputError({ color: "#0b1220" })).toBeNull(); // any VALID hex is allowed, incl. dark
  });
  it("rejects a non-hex colour instead of silently recoloring to the accent", () => {
    expect(segmentInputError({ color: "rebeccapurple" })).toMatch(/hex/i);
  });
  it("rejects an over-long or empty name instead of silently truncating", () => {
    expect(segmentInputError({ name: "x".repeat(61) })).toMatch(/60 characters/);
    expect(segmentInputError({ name: "   " })).toMatch(/empty/i);
    expect(segmentInputError({ name: "x".repeat(60) })).toBeNull(); // at the bound is fine
  });
  it("rejects a non-string name or colour instead of throwing", () => {
    expect(segmentInputError({ name: 12 })).toMatch(/text/i);
    expect(segmentInputError({ color: 12 })).toMatch(/hex/i);
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

  it("unions dimensions from both sides (sorted) and leaves a missing side null", () => {
    const a = summary({ dimAverages: [{ dimId: "D2", avg: 60 }, { dimId: "D1", avg: 90 }] });
    const b = summary({ dimAverages: [{ dimId: "D1", avg: 40 }, { dimId: "D8", avg: 30 }] });
    const c = buildSegmentComparison(a, b);
    expect(c.dimDeltas.map((d) => d.dimId)).toEqual(["D1", "D2", "D8"]);
    expect(c.dimDeltas).toContainEqual({ dimId: "D1", a: 90, b: 40, delta: 50 });
    expect(c.dimDeltas).toContainEqual({ dimId: "D2", a: 60, b: null, delta: null }); // absent in b
    expect(c.dimDeltas).toContainEqual({ dimId: "D8", a: null, b: 30, delta: null }); // absent in a
  });

  it("keeps a dimension MEASURED at zero as 0, distinguishable from a missing side", () => {
    const a = summary({ dimAverages: [{ dimId: "D1", avg: 0 }, { dimId: "D2", avg: 80 }] });
    const b = summary({ dimAverages: [{ dimId: "D1", avg: 40 }] });
    const c = buildSegmentComparison(a, b);
    expect(c.dimDeltas).toContainEqual({ dimId: "D1", a: 0, b: 40, delta: -40 });
    expect(c.dimDeltas).toContainEqual({ dimId: "D2", a: 80, b: null, delta: null });
  });
});

// ── Cross-tenant isolation of repo tagging ────────────────────────────────────────────────────────
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
 * (used by the canonical getOrgId resolver) maps a slug → its id via `slugToId`. Resolution is
 * case-insensitive — mirroring production, where org rows are stored lower-cased and getOrgId queries
 * with a normalized (trim + lower-case) slug — so a fixture keyed `A` still resolves a caller's `A`.
 * Every write method is a spy so we can assert it was (or, for cross-tenant, was NOT) called.
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
        const key = Object.keys(opts.slugToId).find((s) => s.toLowerCase() === where.slug.trim().toLowerCase());
        const id = key ? opts.slugToId[key] : undefined;
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

  it("tags a padded mixed-case fullName against the stored canonical key", async () => {
    const fp = fakePrisma({ ownerOrgId: "orgA", slugToId: { A: "orgA" }, repoFullNames: ["acme/repo"] });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const ok = await setRepoSegment("A", "seg1", " Acme/Repo ", true);

    expect(ok).toBe(true);
    expect(fp.calls.repoFindUnique[0]!.where.orgId_fullName.fullName).toBe("acme/repo");
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

  it("bulk-tags a padded mixed-case fullName against the stored canonical key", async () => {
    const fp = fakePrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      repoFullNames: ["acme/repo"],
      createCount: 1,
    });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const changed = await setRepoSegmentsBulk("A", "seg1", [" Acme/Repo "], true);

    expect(changed).toBe(1);
    expect(fp.calls.repoFindMany[0]!.where.fullName.in).toEqual(["acme/repo"]);
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

// ── Membership-write IDEMPOTENCY ──────────────────────────────────────────────────────────────────
//
// The count contract (-1 / 0 / res.count) and fullName dedup are pinned above. What was NOT pinned is
// the *write shape* that makes the membership writes idempotent — the load-bearing half of the finding:
//   • single tag re-applied  → prisma.repoSegment.upsert with where:{ segmentId_repoId }, update:{} and
//     create:{ segmentId, repoId } — an UPSERT, not an INSERT, so re-tagging an already-member repo is a
//     no-op (no duplicate row, no unique-constraint error). If a refactor swaps upsert→create, this goes red.
//   • single untag of a repo NOT in the segment → deleteMany matches 0 rows but still resolves true (a
//     legitimate no-op, never an error / never false).
//   • bulk add over a set that's ALREADY tagged → createMany({ skipDuplicates:true }) returns res.count = 0
//     (only newly-added rows counted), the route shows "0 changed", NOT a duplicate-key crash and NOT an
//     inflated count.
//   • bulk untag of repos not in the segment → deleteMany returns 0 (clean no-op, not -1 / not a 404).

describe("membership-write idempotency", () => {
  it("setRepoSegment tag uses an idempotent upsert (where keyed on segmentId_repoId, update:{}, create) — re-tag is a no-op", async () => {
    const fp = fakePrisma({ ownerOrgId: "orgA", slugToId: { A: "orgA" }, repoFullNames: ["acme/repo"] });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const ok = await setRepoSegment("A", "seg1", "acme/repo", true);

    expect(ok).toBe(true);
    // The write is an UPSERT (idempotent), not a bare create: an already-tagged repo hits the conflict
    // branch (update:{}) and produces no second row — so applying the same tag twice is a no-op.
    expect(fp.upsert).toHaveBeenCalledTimes(1);
    const arg = fp.upsert.mock.calls[0]![0] as {
      where: { segmentId_repoId: { segmentId: string; repoId: string } };
      update: Record<string, unknown>;
      create: { segmentId: string; repoId: string };
    };
    expect(arg.where.segmentId_repoId).toMatchObject({ segmentId: "seg1", repoId: "repo_acme_repo" });
    expect(arg.update).toEqual({}); // conflict branch does nothing → re-tag changes nothing
    expect(arg.create).toMatchObject({ segmentId: "seg1", repoId: "repo_acme_repo" });
  });

  it("setRepoSegment untag of a repo NOT in the segment is a clean no-op (deleteMany matches 0, still true)", async () => {
    // deleteCount defaults to 0 → deleteMany resolves { count: 0 } as if the repo wasn't tagged.
    const fp = fakePrisma({ ownerOrgId: "orgA", slugToId: { A: "orgA" }, repoFullNames: ["acme/repo"] });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const ok = await setRepoSegment("A", "seg1", "acme/repo", false);

    // Removing an absent membership neither errors nor returns false — it is idempotent.
    expect(ok).toBe(true);
    expect(fp.deleteMany).toHaveBeenCalledTimes(1);
    expect(fp.deleteMany.mock.calls[0]![0]).toMatchObject({ where: { segmentId: "seg1", repoId: "repo_acme_repo" } });
    expect(fp.upsert).not.toHaveBeenCalled();
  });

  it("setRepoSegmentsBulk re-tag of an already-tagged set returns 0 via skipDuplicates — no dup, no crash, no inflation", async () => {
    // The repos resolve, but every membership already exists → createMany({skipDuplicates}) skips them all
    // and reports count 0. The contract demands 0 (a real, in-org no-op) — distinct from -1 (not owned).
    const fp = fakePrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      repoFullNames: ["a/one", "a/two"],
      createCount: 0, // all duplicates skipped
    });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const changed = await setRepoSegmentsBulk("A", "seg1", ["a/one", "a/two"], true);

    expect(changed).toBe(0); // only NEWLY-added rows counted; idempotent re-tag adds none
    expect(changed).not.toBe(-1); // and it is NOT the not-owned sentinel — the segment IS the org's
    expect(fp.createMany).toHaveBeenCalledTimes(1);
    expect(fp.createMany.mock.calls[0]![0]).toMatchObject({ skipDuplicates: true });
  });

  it("setRepoSegmentsBulk untag of repos not in the segment is a no-op count 0, never -1", async () => {
    // Repos exist under the org but none are tagged → deleteMany matches 0 rows → 0 (a clean no-op).
    const fp = fakePrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      repoFullNames: ["a/one"],
      deleteCount: 0,
    });
    mockGetPrisma.mockReturnValue(fp.prisma);

    const changed = await setRepoSegmentsBulk("A", "seg1", ["a/one"], false);

    expect(changed).toBe(0);
    expect(changed).not.toBe(-1); // an in-org untag that removes nothing is 0, not a 404
    expect(fp.deleteMany).toHaveBeenCalledTimes(1);
    expect(fp.createMany).not.toHaveBeenCalled();
  });
});

// ── segmentScope: the fragment every OTHER scoped aggregate still narrows through ──────────────────────────────────
//
// A scoped rollup is `getOrgRollup(orgSlug, window, segmentId)` → segmentScope(segmentId) →
// `{ segments: { some: { segmentId } } }` spread into the repo query. If segmentScope ever returns {}
// for a non-null id, EVERY scoped aggregate silently reports the whole-fleet average — two identical
// columns with a zero delta, "platform and legacy are equally mature", the exact comparison theater the
// feature exists to disprove, and it would ship green without this test.
//
// The SEGMENT COMPARISON no longer goes through here (2026-10-05): it partitions one unscoped rollup in
// memory, and the describe below this one pins that partition with the same anti-theater assertions.
// Every other segment-scoped aggregate in src/lib/db/org.ts still does, which is why the fragment keeps
// its own pin.

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

// ── The comparison is ONE fleet rollup, partitioned — and it carries the population it averaged ─────
//
// Two contracts live here, and the first used to be the mechanism for the second.
//
// (1) SCOPE. Every per-segment number must come from that segment's repos, never the fleet's. This was
//     enforced by a scoped getOrgRollup per side (`segments.some.segmentId` in the where), and the pin
//     was "the id reached the query". compareSegments now fetches ONE unscoped rollup and partitions it
//     by the membership map, so the pin is the same ANTI-COMPARISON-THEATER assertion against the
//     partition instead: two different segments must still produce different columns and a non-zero
//     delta, an empty segment must still be unmeasured rather than falling back to the fleet, and the
//     fleet baseline must still be the whole fleet. segmentScope's own fragment is still pinned above,
//     because every OTHER scoped aggregate still goes through it.
//
// (2) COST. Three full getOrgRollup transfers for one screen (one for the strip, one per comparison
//     side) on a query whose own header documents that a nested `take` does not bound the transfer, so
//     "the org's ENTIRE scan history crosses the wire" each time. Counted here as rollup-shaped
//     `repository.findMany` calls — the select that joins `scans` — because that is the transfer being
//     paid for. Measured 2026-10-05: 3 before, 1 after.
//
// And the shape the populations ride on: `points`, the per-repo per-dimension scores the reducer was
// already walking (it threw them away after averaging), which is what lets the view draw a segment as
// a population instead of a dot. `avgOverall` must be UNCHANGED by their arrival — the regression
// assertion below is the same fixture's mean, byte-identical.

/**
 * A fakePrisma that drives the REAL getOrgRollup, listSegments, listSegmentMembers and
 * listTaggableRepos. `repos` is the whole fleet (each with its latest scan + per-dimension rows);
 * `membership` is segmentId → tagged fullNames. Nothing here is scoped by segment: a regression that
 * re-introduced a per-segment rollup would show up as an extra `rollupQueries` entry, and one that
 * stopped partitioning would show up as two identical sides.
 */
type FakeRepo = { fullName: string; overall: number; adoption: number; rigor: number; dims: Record<string, number> };

function viewPrisma(opts: {
  orgSlug: string;
  orgId: string;
  segments: { id: string; name: string }[];
  repos: FakeRepo[];
  membership: Record<string, string[]>;
}) {
  /** Rollup-shaped repo reads only: the select carrying the rollup's cached-blob columns (its latest scan
   *  per repo is a separate groupBy + pair fetch since economics-1, so a `scans` join no longer marks
   *  it). listTaggableRepos' cheap select is deliberately NOT counted — three scalar columns. */
  const rollupQueries: Array<Record<string, unknown>> = [];
  const taggableQueries: Array<Record<string, unknown>> = [];

  const repoRow = (r: FakeRepo) => ({
    id: r.fullName,
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
    teams: [],
    scans: [
      {
        level: "L3",
        overallScore: r.overall,
        adoptionScore: r.adoption,
        rigorScore: r.rigor,
        posture: "ai-native",
        scannedAt: new Date("2026-01-01T00:00:00Z"),
        dimensions: Object.entries(r.dims).map(([dimId, score]) => ({ dimId, score })),
      },
    ],
  });

  const prisma = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => (where.slug === opts.orgSlug ? { id: opts.orgId } : null)),
    },
    segment: {
      findMany: vi.fn(async ({ where }: { where: { orgId: string; id?: { in: string[] } } }) => {
        if (where.orgId !== opts.orgId) return [];
        return opts.segments
          .filter((s) => !where.id || where.id.in.includes(s.id))
          .map((s) => ({
            id: s.id,
            name: s.name,
            color: "#3b9eff",
            ruleJson: null,
            createdAt: new Date("2026-01-01T00:00:00Z"),
            _count: { repos: (opts.membership[s.id] ?? []).length },
          }));
      }),
    },
    repoSegment: {
      findMany: vi.fn(async () =>
        Object.entries(opts.membership).flatMap(([segmentId, names]) =>
          names.map((fullName) => ({ segmentId, source: "manual", repo: { fullName } })),
        ),
      ),
    },
    repository: {
      findMany: vi.fn(async ({ where, select }: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
        if (select.techStackJson) rollupQueries.push(where);
        else taggableQueries.push(where);
        if (where.orgId !== opts.orgId) return [];
        return opts.repos.map(repoRow);
      }),
    },
    // Each repo's latest scan (the nested one on its row) through the groupBy + pair fetch; every other
    // scan.findMany is the trend read.
    scan: latestScanReads(
      () => scansOfRepoRows(opts.repos.map(repoRow)),
      () => opts.repos.map((r) => ({ scannedAt: new Date("2026-01-01T00:00:00Z"), overallScore: r.overall })),
    ),
  };
  return { prisma, rollupQueries, taggableQueries };
}

describe("compareSegments / loadSegmentsView — one rollup, partitioned, carrying its population", () => {
  // Acceptance fixture: A has 3 scanned repos (40/60/80), B has 2 (70/90).
  const A_REPOS: FakeRepo[] = [
    { fullName: "acme/a-one", overall: 40, adoption: 40, rigor: 40, dims: { D1: 40, d5: 30 } },
    { fullName: "acme/a-two", overall: 60, adoption: 60, rigor: 60, dims: { D1: 60, d5: 50 } },
    { fullName: "acme/a-three", overall: 80, adoption: 80, rigor: 80, dims: { D1: 80 } }, // no d5 row
  ];
  const B_REPOS: FakeRepo[] = [
    { fullName: "acme/b-one", overall: 70, adoption: 70, rigor: 70, dims: { D1: 70, d5: 64 } },
    { fullName: "acme/b-two", overall: 90, adoption: 90, rigor: 90, dims: { D1: 90, d5: 80 } },
  ];

  function harness(over?: { membership?: Record<string, string[]>; repos?: FakeRepo[] }) {
    const vp = viewPrisma({
      orgSlug: "acme",
      orgId: "org_acme",
      segments: [
        { id: "platform", name: "Platform" },
        { id: "legacy", name: "Legacy" },
      ],
      repos: over?.repos ?? [...A_REPOS, ...B_REPOS],
      membership:
        over?.membership ?? {
          platform: A_REPOS.map((r) => r.fullName),
          legacy: B_REPOS.map((r) => r.fullName),
        },
    });
    mockGetPrisma.mockReturnValue(vp.prisma);
    return vp;
  }

  it("carries each side's per-repo points, and the means are UNCHANGED by their arrival", async () => {
    harness();
    const cmp = await compareSegments("acme", "platform", "legacy");
    expect(cmp).not.toBeNull();

    expect(cmp!.a.points).toHaveLength(3);
    expect(cmp!.b.points).toHaveLength(2);
    // Identity + overall + the per-dimension scores, which is what makes a laggard nameable.
    expect(cmp!.a.points.map((p) => p.overall).sort((x, y) => x - y)).toEqual([40, 60, 80]);
    const one = cmp!.a.points.find((p) => p.fullName === "acme/a-one")!;
    expect(one.dims).toEqual([
      { dimId: "D1", score: 40 },
      { dimId: "d5", score: 30 },
    ]);
    // A repo the latest scan did not grade on d5 carries NO d5 entry — absent, not 0.
    expect(cmp!.a.points.find((p) => p.fullName === "acme/a-three")!.dims.map((d) => d.dimId)).toEqual(["D1"]);

    // THE REGRESSION ASSERTION: the mean is the same number it has always been for this fixture.
    expect(cmp!.a.avgOverall).toBe(60); // (40+60+80)/3
    expect(cmp!.b.avgOverall).toBe(80); // (70+90)/2
    expect(cmp!.deltas.overall).toBe(-20);
    // points and the mean are the same arithmetic over the same rows, by construction.
    expect(cmp!.a.points).toHaveLength(cmp!.a.scannedCount);
  });

  it("loading the Segments view issues exactly ONE rollup-shaped repository.findMany (was three)", async () => {
    const vp = harness();
    const view = await loadSegmentsView("acme", { a: "platform", b: "legacy" });
    expect(view).not.toBeNull();
    // Both readings are present — the strip AND the comparison — off a single fleet transfer.
    expect(view!.summaries).toHaveLength(2);
    expect(view!.comparison).not.toBeNull();
    expect(vp.rollupQueries).toHaveLength(1);
    // And it is the UNSCOPED fleet query: the partition happens in memory, so no `segments` filter.
    expect(vp.rollupQueries[0]).not.toHaveProperty("segments");
  });

  it("even the two readings taken SEPARATELY cost two rollups, not three", async () => {
    const vp = harness();
    await listSegmentSummaries("acme");
    await compareSegments("acme", "platform", "legacy");
    // One each. It used to be one + two (a scoped rollup per comparison side).
    expect(vp.rollupQueries).toHaveLength(2);
    expect(vp.rollupQueries.every((w) => !("segments" in w))).toBe(true);
  });

  it("ANTI-COMPARISON-THEATER: two segments partition to DIFFERENT populations and a non-zero delta", async () => {
    harness();
    const cmp = await compareSegments("acme", "platform", "legacy");
    expect(cmp!.a.points.map((p) => p.fullName)).toEqual(["acme/a-one", "acme/a-two", "acme/a-three"]);
    expect(cmp!.b.points.map((p) => p.fullName)).toEqual(["acme/b-one", "acme/b-two"]);
    expect(cmp!.a.avgOverall).not.toBe(cmp!.b.avgOverall);
    expect(cmp!.deltas.overall).not.toBe(0);
    // Per-dimension: d5 is the gap this card's drill-down is about.
    const d5 = cmp!.dimDeltas.find((d) => d.dimId === "d5")!;
    expect(d5.a).toBe(40); // (30+50)/2 — a-three has no d5 row and is NOT averaged in as a 0
    expect(d5.b).toBe(72); // (64+80)/2
    expect(d5.delta).toBe(-32);
  });

  it("side B = whole fleet: its points are EVERY scanned repo in the rollup", async () => {
    harness();
    const cmp = await compareSegments("acme", "platform", null);
    expect(cmp!.b.id).toBeNull();
    expect(cmp!.b.name).toBe("Whole fleet");
    expect(cmp!.b.points).toHaveLength(5);
    expect(cmp!.b.avgOverall).toBe(Math.round((40 + 60 + 80 + 70 + 90) / 5)); // 68
    expect(cmp!.a.points).toHaveLength(3); // the segment side is still only its own
  });

  it("a segment with nothing scanned has NO points and NO average — not a point at 0", async () => {
    harness({ membership: { platform: [], legacy: B_REPOS.map((r) => r.fullName) } });
    const cmp = await compareSegments("acme", "platform", "legacy");
    expect(cmp!.a.points).toEqual([]);
    expect(cmp!.a.scannedCount).toBe(0);
    expect(cmp!.a.avgOverall).toBeNull();
    expect(cmp!.a.posture).toBeNull();
    expect(cmp!.deltas.overall).toBeNull();
    // It did NOT fall through to the whole fleet.
    expect(cmp!.a.avgOverall).not.toBe(68);
  });

  it("a one-repo segment carries exactly one point beside its mean, so n=1 is visible to the view", async () => {
    harness({ membership: { platform: ["acme/a-two"], legacy: B_REPOS.map((r) => r.fullName) } });
    const cmp = await compareSegments("acme", "platform", "legacy");
    expect(cmp!.a.points).toHaveLength(1);
    expect(cmp!.a.scannedCount).toBe(1);
    expect(cmp!.a.avgOverall).toBe(60);
  });

  it("an `a` that is not a segment of the org is still no comparison (never a silent substitution)", async () => {
    harness();
    expect(await compareSegments("acme", "not-a-segment", "legacy")).toBeNull();
  });
});

describe("resolveComparePair — the A/B selection both Segments views used to copy", () => {
  const options = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];

  it("view mode: a missing or unknown `a` falls back to the first segment and `b` to the next", () => {
    expect(resolveComparePair(options, undefined, undefined)).toEqual({ aId: "s1", bId: "s2" });
    expect(resolveComparePair(options, "nope", undefined)).toEqual({ aId: "s1", bId: "s2" });
    expect(resolveComparePair(options, "s2", "s2")).toEqual({ aId: "s2", bId: "s1" });
    expect(resolveComparePair(options, "s3", "s1")).toEqual({ aId: "s3", bId: "s1" });
    expect(resolveComparePair([], undefined, undefined)).toEqual({ aId: null, bId: null });
  });

  it("exact mode (compareSegments): an unknown `a` resolves to null rather than a different segment", () => {
    expect(resolveComparePair(options, "nope", "s2", { exact: true })).toEqual({ aId: null, bId: null });
    // An unknown or absent `b` is the whole-fleet baseline, which is what a null bId has always meant.
    expect(resolveComparePair(options, "s1", "nope", { exact: true })).toEqual({ aId: "s1", bId: null });
    expect(resolveComparePair(options, "s1", null, { exact: true })).toEqual({ aId: "s1", bId: null });
  });
});

// ── getRepoSegmentMap inversion + sorted, deduped output ────────────────────────────────────────────
//
// getRepoSegmentMap reads flat repoSegment rows (segment→repo membership) and INVERTS them into a
// fullName → segments[] map consumed two ways that both trust its exact shape: the repositories page
// builds the per-repo tagging chips from it, and the segments page RE-inverts it into reposBySegment.
// The contract pinned here: (a) the query is org-scoped via where.segment.orgId; (b) a repo in N
// segments lists all N (the inversion); (c) each repo's list is SORTED by segment name via
// localeCompare; (d) a repo never appears twice for the SAME segment (dedup of a repeated row); (e)
// two repos sharing a segment each carry that segment; (f) a repo in zero segments is ABSENT (no
// empty array); (g) empty rows → empty map; (h) an unknown/unconfigured org → empty map, no query.
// A regression — dropping the sort, an overwrite instead of push, or losing the orgId filter —
// scrambles the chip order or the inverted action targets and these go red.

/**
 * A minimal fakePrisma for getRepoSegmentMap: `organization.findUnique` resolves a slug → id (via
 * resolveOrgId), and `repoSegment.findMany` returns the supplied flat rows, capturing the `where` so
 * we can assert the org scope. Rows are the real selected shape: { repo:{fullName}, segment:{id,name,color} }.
 */
function mapPrisma(opts: {
  orgSlug: string;
  orgId: string;
  rows: { repo: { fullName: string }; segment: { id: string; name: string; color: string } }[];
}) {
  const findManyCalls: Array<{ where: { segment: { orgId: string } } }> = [];
  const prisma = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) =>
        where.slug === opts.orgSlug ? { id: opts.orgId } : null,
      ),
    },
    repoSegment: {
      findMany: vi.fn(async ({ where }: { where: { segment: { orgId: string } } }) => {
        findManyCalls.push({ where });
        // Mirror the real per-tenant filter: only the owning org sees its rows.
        return where.segment.orgId === opts.orgId ? opts.rows : [];
      }),
    },
  };
  return { prisma, findManyCalls };
}

const seg = (id: string, name: string, color = "#ffffff") => ({ id, name, color });
const row = (fullName: string, s: { id: string; name: string; color: string }) => ({
  repo: { fullName },
  segment: s,
});

describe("getRepoSegmentMap — inverts segment→repo rows into a sorted, deduped repo→segments map", () => {
  it("scopes the row query to the resolved orgId via where.segment.orgId", async () => {
    const mp = mapPrisma({
      orgSlug: "acme",
      orgId: "org_acme",
      rows: [row("acme/one", seg("p", "Platform"))],
    });
    mockGetPrisma.mockReturnValue(mp.prisma);

    await getRepoSegmentMap("acme");

    // The load-bearing tenant filter: the inversion only ever sees this org's membership rows.
    expect(mp.findManyCalls).toHaveLength(1);
    expect(mp.findManyCalls[0]!.where).toMatchObject({ segment: { orgId: "org_acme" } });
  });

  it("a repo tagged into TWO segments lists both, sorted by segment name (localeCompare)", async () => {
    // Rows arrive in a non-sorted order ("Platform" before "Legacy") to prove the sort, not insertion order.
    const mp = mapPrisma({
      orgSlug: "acme",
      orgId: "org_acme",
      rows: [
        row("acme/one", seg("p", "Platform")),
        row("acme/one", seg("l", "Legacy")),
      ],
    });
    mockGetPrisma.mockReturnValue(mp.prisma);

    const map = await getRepoSegmentMap("acme");

    expect(Object.keys(map)).toEqual(["acme/one"]);
    // Inversion: the repo carries BOTH of its segments…
    expect(map["acme/one"]!.map((s) => s.id).sort()).toEqual(["l", "p"]);
    // …and the per-repo list is name-SORTED ("Legacy" < "Platform"), regardless of row order.
    expect(map["acme/one"]!.map((s) => s.name)).toEqual(["Legacy", "Platform"]);
    // Each entry keeps its full { id, name, color } shape the chips depend on.
    expect(map["acme/one"]![0]).toEqual({ id: "l", name: "Legacy", color: "#ffffff" });
  });

  it("two repos sharing a segment each carry that segment (the inversion fans out per repo)", async () => {
    const platform = seg("p", "Platform");
    const mp = mapPrisma({
      orgSlug: "acme",
      orgId: "org_acme",
      rows: [row("acme/one", platform), row("acme/two", platform)],
    });
    mockGetPrisma.mockReturnValue(mp.prisma);

    const map = await getRepoSegmentMap("acme");

    expect(Object.keys(map).sort()).toEqual(["acme/one", "acme/two"]);
    expect(map["acme/one"]!.map((s) => s.id)).toEqual(["p"]);
    expect(map["acme/two"]!.map((s) => s.id)).toEqual(["p"]);
  });

  it("lists each of a repo's segments exactly once — distinct memberships are not conflated", async () => {
    // The findMany rows are one-per-(segment,repo) — the DB's unique (segmentId, repoId) constraint
    // guarantees a repo can't have two rows for the SAME segment. So a repo in three DISTINCT segments
    // yields three entries with no duplicate segment id: the inversion preserves that 1:1 faithfully.
    const mp = mapPrisma({
      orgSlug: "acme",
      orgId: "org_acme",
      rows: [
        row("acme/one", seg("p", "Platform")),
        row("acme/one", seg("l", "Legacy")),
        row("acme/one", seg("m", "Mobile")),
      ],
    });
    mockGetPrisma.mockReturnValue(mp.prisma);

    const map = await getRepoSegmentMap("acme");

    const ids = map["acme/one"]!.map((s) => s.id);
    expect(ids).toEqual(["l", "m", "p"]); // all three, sorted by name, none repeated
    expect(new Set(ids).size).toBe(ids.length); // no segment listed twice for this repo
  });

  it("a repo in NO segment is absent from the map (no empty-array surprise for consumers)", async () => {
    // acme/two is never tagged, so it simply never appears as a key.
    const mp = mapPrisma({
      orgSlug: "acme",
      orgId: "org_acme",
      rows: [row("acme/one", seg("p", "Platform"))],
    });
    mockGetPrisma.mockReturnValue(mp.prisma);

    const map = await getRepoSegmentMap("acme");

    expect(map).toHaveProperty("acme/one");
    expect(map).not.toHaveProperty("acme/two"); // absent, NOT map["acme/two"] === []
  });

  it("empty membership rows → empty map", async () => {
    const mp = mapPrisma({ orgSlug: "acme", orgId: "org_acme", rows: [] });
    mockGetPrisma.mockReturnValue(mp.prisma);

    expect(await getRepoSegmentMap("acme")).toEqual({});
  });

  it("an unknown org slug → empty map, and the membership rows are never queried", async () => {
    const mp = mapPrisma({ orgSlug: "acme", orgId: "org_acme", rows: [row("acme/one", seg("p", "Platform"))] });
    mockGetPrisma.mockReturnValue(mp.prisma);

    expect(await getRepoSegmentMap("ghost")).toEqual({}); // resolveOrgId → null short-circuits
    expect(mp.findManyCalls).toHaveLength(0);
  });
});

// ── applySegmentRule — the convergence write, and the row-ownership rule that bounds it ───────────
//
// "Segments keep a rule, not a snapshot" (acceptance cases 2, 3 and 7). This is the only destructive
// path in the segments layer: it DELETES membership rows. The whole safety of the feature rests on it
// deleting only rows it owns (`source: "rule"`), so the ownership split is asserted here against a
// fake that actually records which rows the deleteMany was scoped to, not just how many.

/**
 * A prisma fake for applySegmentRule: one owning org, a taggable repo universe (watched OR has-scans)
 * with a primaryLanguage + teams per repo, and the segment's current membership rows WITH their
 * `source`. `$transaction` runs the handed array, so the add and the reap are observed exactly as the
 * production code batches them.
 */
function applyPrisma(opts: {
  ownerOrgId: string;
  slugToId: Record<string, string>;
  ruleJson: string | null;
  universe: { fullName: string; primaryLanguage: string | null; teams?: string[] }[];
  rows: { fullName: string; source: string }[];
}) {
  const repoId = (fullName: string) => `repo_${fullName.replace(/[^a-z0-9]/gi, "_")}`;
  const createMany = vi.fn(async (args: { data: { segmentId: string; repoId: string; source?: string }[] }) => ({
    count: args.data.length,
  }));
  const deleteMany = vi.fn(
    async (args: { where: { segmentId: string; source?: string; repoId?: { in: string[] } } }) => ({
      count: args.where.repoId?.in.length ?? 0,
    }),
  );
  const prisma = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => {
        const key = Object.keys(opts.slugToId).find((s) => s.toLowerCase() === where.slug.trim().toLowerCase());
        const id = key ? opts.slugToId[key] : undefined;
        return id ? { id } : null;
      }),
    },
    segment: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; orgId: string } }) =>
        where.orgId === opts.ownerOrgId ? { id: where.id, ruleJson: opts.ruleJson } : null,
      ),
    },
    repository: {
      findMany: vi.fn(async () =>
        opts.universe.map((r) => ({
          id: repoId(r.fullName),
          fullName: r.fullName,
          primaryLanguage: r.primaryLanguage,
          teams: (r.teams ?? []).map((slug) => ({ slug })),
        })),
      ),
    },
    repoSegment: {
      findMany: vi.fn(async () => opts.rows.map((r) => ({ repoId: repoId(r.fullName), source: r.source }))),
      createMany,
      deleteMany,
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma, createMany, deleteMany, repoId };
}

const PY_RULE = JSON.stringify({ kind: "language", values: ["Python"] });

describe("applySegmentRule", () => {
  it("adds every matching untagged repo as RULE-owned and reports { added, removed }", async () => {
    const ap = applyPrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      ruleJson: PY_RULE,
      universe: [1, 2, 3, 4, 5].map((n) => ({ fullName: `a/py${n}`, primaryLanguage: "Python" })),
      rows: [],
    });
    mockGetPrisma.mockReturnValue(ap.prisma);

    const res = await applySegmentRule("A", "seg1");

    expect(res).toEqual({ added: 5, removed: 0 });
    expect(ap.createMany).toHaveBeenCalledTimes(1);
    // Provenance is the point: every row this write creates is stamped "rule", so a later apply is
    // allowed to reap it. A row created without a source would be indistinguishable from a hand-tag.
    const created = ap.createMany.mock.calls[0]![0].data;
    expect(created).toHaveLength(5);
    expect(created.every((d) => d.source === "rule")).toBe(true);
    expect(ap.deleteMany).not.toHaveBeenCalled();
  });

  it("is IDEMPOTENT: a second apply adds nothing, removes nothing and rewrites no row", async () => {
    const ap = applyPrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      ruleJson: PY_RULE,
      universe: [1, 2, 3, 4, 5].map((n) => ({ fullName: `a/py${n}`, primaryLanguage: "Python" })),
      rows: [1, 2, 3, 4, 5].map((n) => ({ fullName: `a/py${n}`, source: "rule" })),
    });
    mockGetPrisma.mockReturnValue(ap.prisma);

    expect(await applySegmentRule("A", "seg1")).toEqual({ added: 0, removed: 0 });
    expect(ap.createMany).not.toHaveBeenCalled();
    expect(ap.deleteMany).not.toHaveBeenCalled();
    expect(ap.prisma.$transaction).not.toHaveBeenCalled();
  });

  // The single most important assertion in this card: a convergence that reaped a human's tag would
  // destroy hand-curated membership silently. Both halves in ONE test so neither can regress alone.
  it("reaps a rule-owned row that no longer matches and KEEPS a hand-tagged row that never did", async () => {
    const ap = applyPrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      ruleJson: PY_RULE,
      universe: [
        { fullName: "a/py1", primaryLanguage: "Python" },
        { fullName: "a/was-python", primaryLanguage: "Go" }, // flipped language, rule-owned
        { fullName: "a/by-hand", primaryLanguage: "Ruby" }, // a human put this here
      ],
      rows: [
        { fullName: "a/py1", source: "rule" },
        { fullName: "a/was-python", source: "rule" },
        { fullName: "a/by-hand", source: "manual" },
      ],
    });
    mockGetPrisma.mockReturnValue(ap.prisma);

    const res = await applySegmentRule("A", "seg1");

    expect(res).toEqual({ added: 0, removed: 1 });
    const where = ap.deleteMany.mock.calls[0]![0].where;
    expect(where.repoId!.in).toEqual([ap.repoId("a/was-python")]);
    expect(where.repoId!.in).not.toContain(ap.repoId("a/by-hand"));
    // Defence in depth: the delete is itself scoped to rule-owned rows, so even a wrong id list
    // could not take a manual row with it.
    expect(where.source).toBe("rule");
  });

  it("never reaps a rule-owned row whose repo has left the taggable universe", async () => {
    const ap = applyPrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      ruleJson: PY_RULE,
      universe: [{ fullName: "a/py1", primaryLanguage: "Python" }],
      rows: [
        { fullName: "a/py1", source: "rule" },
        { fullName: "a/archived", source: "rule" },
      ],
    });
    mockGetPrisma.mockReturnValue(ap.prisma);

    expect(await applySegmentRule("A", "seg1")).toEqual({ added: 0, removed: 0 });
    expect(ap.deleteMany).not.toHaveBeenCalled();
  });

  it("CROSS-TENANT: another org's segment id -> null, and no write is reached", async () => {
    const ap = applyPrisma({
      ownerOrgId: "orgB",
      slugToId: { A: "orgA" },
      ruleJson: PY_RULE,
      universe: [{ fullName: "a/py1", primaryLanguage: "Python" }],
      rows: [],
    });
    mockGetPrisma.mockReturnValue(ap.prisma);

    expect(await applySegmentRule("A", "seg1")).toBeNull();
    expect(ap.createMany).not.toHaveBeenCalled();
    expect(ap.deleteMany).not.toHaveBeenCalled();
  });

  it("an unknown org slug, or a segment with no rule, changes nothing and returns null (no throw)", async () => {
    const unknownOrg = applyPrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      ruleJson: PY_RULE,
      universe: [],
      rows: [],
    });
    mockGetPrisma.mockReturnValue(unknownOrg.prisma);
    expect(await applySegmentRule("ghost", "seg1")).toBeNull();

    const noRule = applyPrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      ruleJson: null,
      universe: [{ fullName: "a/py1", primaryLanguage: "Python" }],
      rows: [],
    });
    mockGetPrisma.mockReturnValue(noRule.prisma);
    expect(await applySegmentRule("A", "seg1")).toBeNull();
    expect(noRule.createMany).not.toHaveBeenCalled();
  });
});

describe("setRepoSegmentsBulk — membership provenance", () => {
  it("stamps hand/bulk tags as MANUAL by default, so a rule can never reap them", async () => {
    const fp = fakePrisma({
      ownerOrgId: "orgA",
      slugToId: { A: "orgA" },
      repoFullNames: ["acme/one"],
      createCount: 1,
    });
    mockGetPrisma.mockReturnValue(fp.prisma);

    await setRepoSegmentsBulk("A", "seg1", ["acme/one"], true);

    const data = (fp.createMany.mock.calls[0]![0] as { data: { source?: string }[] }).data;
    expect(data.every((d) => d.source === "manual")).toBe(true);
  });
});
