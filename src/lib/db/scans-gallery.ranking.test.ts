// The landing register + /about fleet read (card portfolio-0): the SECOND public ranking over the
// corpus /leaderboard reads, so it holds the same two invariants - tenancy per query and per row, and
// a mock score is never ranked - and it ranks in the same order as getPublicRegister.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";

type Fixture = { id: string; fullName: string; overall: number; engine: string | null; isPrivate?: boolean; at?: string };
type Args = { where?: Record<string, unknown>; take?: number };

const h = vi.hoisted(() => ({ rows: [] as Fixture[] }));

function rowOf(f: Fixture) {
  const [owner, name] = f.fullName.split("/");
  return {
    id: f.id,
    owner,
    name,
    fullName: f.fullName,
    isPrivate: f.isPrivate ?? false,
    primaryLanguage: "TypeScript",
    stars: 1,
    scans: [
      {
        headSha: null,
        overallScore: f.overall,
        level: "L3",
        levelName: "Managed",
        adoptionScore: 50,
        rigorScore: 50,
        posture: "ai-native",
        engineProvider: f.engine,
        confidence: 0.9,
        prStats: JSON.stringify({ merged: 3 }),
        rubricVersion: SCORING_RUBRIC_VERSION,
        archetype: "org",
        scannedAt: new Date(f.at ?? "2026-10-01T00:00:00.000Z"),
        dimensions: [],
      },
    ],
  };
}

// A tiny in-memory corpus that honours the where shapes both modules issue.
const engineOk = (w: Args["where"], engine: string | null) => {
  const e = w?.engineProvider as undefined | string | { not: string };
  if (e == null) return true;
  return typeof e === "string" ? engine === e : engine !== e.not;
};
const repoOk = (w: Record<string, unknown> | undefined, f: Fixture) => {
  const ids = (w?.id as { in?: string[] } | undefined)?.in;
  return (w?.isPrivate === undefined || (f.isPrivate ?? false) === w.isPrivate) && (!ids || ids.includes(f.id));
};
const byScore = (a: Fixture, b: Fixture) => b.overall - a.overall;
const scanIds = async (a: Args) =>
  h.rows
    .filter((f) => repoOk(a.where?.repo as Record<string, unknown>, f) && engineOk(a.where, f.engine))
    .sort(byScore)
    .slice(0, a.take)
    .map((f) => ({ repoId: f.id }));

const prisma = {
  scan: { groupBy: vi.fn(scanIds), findMany: vi.fn(scanIds) },
  repository: {
    findMany: vi.fn(async (a: Args) => h.rows.filter((f) => repoOk(a.where, f)).slice(0, a.take).map(rowOf)),
    count: vi.fn(async () => h.rows.length),
  },
};

vi.mock("next/cache", () => ({ unstable_cache: <F,>(fn: F) => fn }));
vi.mock("@/lib/db/mode", () => ({ getDbMode: () => "static" }));
vi.mock("@/lib/db/scans-shared", () => ({ DEFAULT_ORG_SLUG: "public", resolveOrgId: async () => "org-public" }));
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => prisma,
  dbReadSafe: <T,>(fn: () => Promise<T>) => fn(),
}));

import { galleryCardFrom, getPublicScanGallery } from "./scans-gallery";
import { getPublicRegister } from "@/lib/register/data";

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = [];
});

describe("galleryCardFrom - tenancy and provenance per row", () => {
  it("refuses a private row that reached the mapper", () => {
    expect(galleryCardFrom(rowOf({ id: "s", fullName: "acme/secret", overall: 90, engine: "anthropic", isPrivate: true }))).toBeNull();
  });

  it("carries verified from isRankableScan: mock and unknown engines are not verified", () => {
    expect(galleryCardFrom(rowOf({ id: "a", fullName: "acme/a", overall: 70, engine: "anthropic" }))?.verified).toBe(true);
    expect(galleryCardFrom(rowOf({ id: "m", fullName: "acme/m", overall: 70, engine: "mock" }))?.verified).toBe(false);
    expect(galleryCardFrom(rowOf({ id: "n", fullName: "acme/n", overall: 70, engine: null }))?.verified).toBe(false);
  });
});

describe("getPublicScanGallery - the landing register never ranks a mock floor", () => {
  it("a mock 95 beside a model 70 -> topAiNative is the 70 alone; the mock stays in recent, unverified", async () => {
    h.rows = [
      { id: "m", fullName: "acme/mock", overall: 95, engine: "mock" },
      { id: "r", fullName: "acme/real", overall: 70, engine: "anthropic" },
    ];
    const g = await getPublicScanGallery();
    expect(g?.topAiNative.map((c) => c.fullName)).toEqual(["acme/real"]);
    expect(g?.topAiNative.every((c) => c.verified)).toBe(true);
    const mock = g?.recent.find((c) => c.fullName === "acme/mock");
    expect(mock?.verified).toBe(false);
  });

  it("the landing hero's example repos (topAiNative.slice(0, 3)) never name the mock report", async () => {
    h.rows = [
      { id: "m", fullName: "acme/mock", overall: 95, engine: "mock" },
      { id: "a", fullName: "acme/a", overall: 80, engine: "claude" },
      { id: "b", fullName: "acme/b", overall: 70, engine: "claude" },
    ];
    const g = await getPublicScanGallery();
    expect(g?.topAiNative.slice(0, 3).map((c) => c.fullName)).toEqual(["acme/a", "acme/b"]);
  });

  it("the leaderboard-only extra fetch re-asserts tenancy, and a private row it returns is in neither rail", async () => {
    h.rows = [
      { id: "pub", fullName: "acme/pub", overall: 60, engine: "anthropic" },
      { id: "sec", fullName: "acme/secret", overall: 99, engine: "anthropic", isPrivate: true },
    ];
    prisma.scan.findMany.mockResolvedValueOnce([{ repoId: "sec" }]);
    // The recency window holds only the public row; the extra fetch hands back the private one, as a
    // where clause that slipped would.
    prisma.repository.findMany
      .mockResolvedValueOnce([rowOf(h.rows[0]!)] as never)
      .mockResolvedValueOnce([rowOf(h.rows[1]!)] as never);
    const g = await getPublicScanGallery();
    const extraWhere = prisma.repository.findMany.mock.calls[1]![0].where as Record<string, unknown>;
    expect(extraWhere).toMatchObject({ id: { in: ["sec"] }, orgId: "org-public", isPrivate: false });
    expect(JSON.stringify(g)).not.toContain("acme/secret");
  });

  it("the score window ranks rankable scans only, so mock floors cannot crowd model scores out of it", async () => {
    h.rows = [{ id: "a", fullName: "acme/a", overall: 70, engine: "anthropic" }];
    await getPublicScanGallery();
    expect(prisma.scan.findMany.mock.calls[0]![0].where).toMatchObject({ engineProvider: { not: "mock" } });
  });
});

describe("one order for both public rankings", () => {
  it("getPublicScanGallery().topAiNative equals getPublicRegister().entries over the same rows", async () => {
    h.rows = [
      { id: "m", fullName: "acme/mock", overall: 95, engine: "mock" },
      { id: "c", fullName: "acme/c", overall: 70, engine: "anthropic" },
      { id: "b", fullName: "acme/b", overall: 70, engine: "anthropic" },
      { id: "a", fullName: "acme/a", overall: 80, engine: "anthropic" },
      { id: "o", fullName: "acme/old", overall: 70, engine: "anthropic", at: "2026-09-01T00:00:00.000Z" },
    ];
    const g = await getPublicScanGallery({ topLimit: 50 });
    const reg = await getPublicRegister({ perPage: 50 });
    const order = reg?.entries.map((e) => e.fullName);
    expect(order).toEqual(["acme/a", "acme/b", "acme/c", "acme/old"]);
    expect(g?.topAiNative.map((c) => c.fullName)).toEqual(order);
  });
});
