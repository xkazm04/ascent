// `since` on the two history readers: absent = today's query; set = the scannedAt floor reaches the
// scan read, the compacted tail drops periods that ended before it, and `take` still bounds the rows
// (the ceiling docs/features/reporting/report.md documents: min(cap, scans in the window)).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: mockGetPrisma,
  dbReadSafe: <T,>(fn: () => Promise<T>) => fn(),
}));
vi.mock("@/lib/db/scans-shared", () => ({
  DEFAULT_ORG_SLUG: "public",
  canonicalOrgSlug: (slug: string) => slug.trim().toLowerCase(),
  canonicalRepoFullName: (owner: string, name: string) => `${owner.trim().toLowerCase()}/${name.trim().toLowerCase()}`,
  resolveOrgId: vi.fn(async () => "org_1"),
  toPersistedRec: vi.fn(),
  parseStringArray: (): string[] => [],
}));

import { getRepositoryHistory, getScanComparison } from "./scans-read";

const row = (id: string, at: string) => ({
  id, headSha: id, overallScore: 70, level: "L3", levelName: "x", confidence: 1, engineProvider: "p",
  engineModel: "m", rubricVersion: null, scannedAt: new Date(at), dimensions: [],
});
const digest = (id: string, last: string) => ({
  id, repoId: "repo_1", period: "2026-01", rubricVersion: "r", engineProvider: "p", scanCount: 2,
  overallSum: 100, adoptionSum: 90, rigorSum: 90, overallMin: 40, overallMax: 60, overallLast: 50,
  adoptionLast: 45, rigorLast: 45, confidenceSum: 2, levelLast: "L2", levelNameLast: "x", postureLast: "p",
  firstScannedAt: new Date("2025-01-01"), lastScannedAt: new Date(last), firstHeadSha: null, lastHeadSha: null,
  enginesJson: '["m"]', dimensionsJson: "{}", recsOpened: 0, recsClosed: 0,
});

function fakePrisma() {
  return {
    repository: { findUnique: vi.fn(async () => ({ id: "repo_1", owner: "o", name: "r", isPrivate: false })) },
    scan: {
      findMany: vi.fn(async () => [row("a", "2026-10-01"), row("b", "2026-09-20")]),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({
        ...row(where.id, "2026-10-01"), archetype: "library", adoptionScore: 1, rigorScore: 1, posture: "p",
        engineDegraded: null, scoreIntegrityJson: null, recommendations: [],
      })),
    },
    scanDigest: { findMany: vi.fn(async () => [digest("new", "2026-09-10"), digest("old", "2026-03-01")]) },
  };
}

const SINCE = new Date("2026-09-08");
beforeEach(() => mockGetPrisma.mockReset());

describe("getRepositoryHistory since", () => {
  it("without since the where is exactly { repoId } and take is the limit (today's query)", async () => {
    const p = fakePrisma();
    mockGetPrisma.mockReturnValue(p);
    await getRepositoryHistory("o", "r", { limit: 25 });
    await getRepositoryHistory("o", "r", { limit: 25, since: null });
    for (const call of p.scan.findMany.mock.calls) {
      expect(call[0]!.where).toEqual({ repoId: "repo_1" });
      expect(call[0]!.take).toBe(25);
    }
  });

  it("with since, BOTH the take and the scannedAt floor reach the scan query", async () => {
    const p = fakePrisma();
    mockGetPrisma.mockReturnValue(p);
    await getRepositoryHistory("o", "r", { limit: 200, since: SINCE });
    const args = p.scan.findMany.mock.calls[0]![0]!;
    expect(args.take).toBe(200);
    expect(args.where).toEqual({ repoId: "repo_1", scannedAt: { gte: SINCE } });
  });

  it("the compacted tail drops every period that ended before the floor", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma());
    const h = await getRepositoryHistory("o", "r", { limit: 10, includeCompacted: true, since: SINCE });
    expect(h!.scans.map((s) => s.id)).toEqual(["a", "b", "digest:new"]);
    mockGetPrisma.mockReturnValue(fakePrisma());
    const all = await getRepositoryHistory("o", "r", { limit: 10, includeCompacted: true });
    expect(all!.scans.map((s) => s.id)).toEqual(["a", "b", "digest:new", "digest:old"]);
  });
});

describe("getScanComparison since", () => {
  it("without since the where is exactly { repoId }; with since the floor is added", async () => {
    const p = fakePrisma();
    mockGetPrisma.mockReturnValue(p);
    await getScanComparison("o", "r", { limit: 60 });
    expect(p.scan.findMany.mock.calls[0]![0]!.where).toEqual({ repoId: "repo_1" });
    await getScanComparison("o", "r", { limit: 60, since: SINCE });
    const args = p.scan.findMany.mock.calls[1]![0]!;
    expect(args.take).toBe(60);
    expect(args.where).toEqual({ repoId: "repo_1", scannedAt: { gte: SINCE } });
  });
});
