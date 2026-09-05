// Coverage exists to expose ABSENCE, so its only interesting failure mode is flattering math: a repo
// with no memory quietly dropped from the denominator, or an empty org reading as 100% covered.

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import { computeCoverage, getMemoryCoverage, FRESH_WINDOW_DAYS } from "./coverage";

const NOW = new Date("2026-07-27T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

beforeEach(() => vi.clearAllMocks());

describe("computeCoverage honest zeros", () => {
  it("counts a repo with NO memory as stale, not as absent from the denominator", () => {
    const c = computeCoverage(
      ["acme/api", "acme/web", "acme/infra"],
      new Map([["acme/api", daysAgo(2)]]),
      NOW,
    );
    expect(c.totalTrackedRepos).toBe(3);
    expect(c.reposWithFreshMemory).toBe(1);
    expect(c.coveragePct).toBe(33);
    expect(c.staleRepos.map((r) => r.fullName)).toEqual(["acme/infra", "acme/web"]);
    expect(c.staleRepos.every((r) => r.lastMemoryAt === null)).toBe(true);
  });

  it("reads 0% — never 100% — for an org that tracks no repos", () => {
    const c = computeCoverage([], new Map(), NOW);
    expect(c).toMatchObject({ totalTrackedRepos: 0, reposWithFreshMemory: 0, coveragePct: 0, staleRepos: [] });
  });

  it("a memory OLDER than the window is stale, and reports when it last spoke", () => {
    const old = daysAgo(FRESH_WINDOW_DAYS + 1);
    const c = computeCoverage(["acme/api"], new Map([["acme/api", old]]), NOW);
    expect(c.reposWithFreshMemory).toBe(0);
    expect(c.coveragePct).toBe(0);
    expect(c.staleRepos[0]).toEqual({ fullName: "acme/api", lastMemoryAt: old.toISOString() });
  });

  it("is inclusive at the window edge (exactly N days old still counts as fresh)", () => {
    const edge = daysAgo(FRESH_WINDOW_DAYS);
    expect(computeCoverage(["acme/api"], new Map([["acme/api", edge]]), NOW).reposWithFreshMemory).toBe(1);
  });

  it("orders stale repos never-covered first, then longest-quiet first", () => {
    const c = computeCoverage(
      ["a/one", "a/two", "a/three"],
      new Map([
        ["a/one", daysAgo(200)],
        ["a/two", daysAgo(60)],
      ]),
      NOW,
    );
    expect(c.staleRepos.map((r) => r.fullName)).toEqual(["a/three", "a/one", "a/two"]);
  });

  it("a duplicate repo row cannot inflate the denominator", () => {
    const c = computeCoverage(["a/one", "a/one", "a/two"], new Map([["a/one", daysAgo(1)]]), NOW);
    expect(c.totalTrackedRepos).toBe(2);
    expect(c.coveragePct).toBe(50);
  });

  it("ignores a memory namespace that matches no tracked repo (coverage is over REPOS)", () => {
    const c = computeCoverage(["a/one"], new Map([["a/ghost", daysAgo(1)]]), NOW);
    expect(c.reposWithFreshMemory).toBe(0);
    expect(c.totalTrackedRepos).toBe(1);
  });
});

describe("getMemoryCoverage", () => {
  it("returns honest zeros for an unknown org rather than throwing", async () => {
    mockGetPrisma.mockReturnValue({ organization: { findUnique: vi.fn(async () => null) } });
    await expect(getMemoryCoverage("nope")).resolves.toMatchObject({ totalTrackedRepos: 0, coveragePct: 0 });
  });

  it("joins repos to memories on namespace and excludes archived/superseded rows", async () => {
    const groupBy = vi.fn(async () => [{ namespace: "acme/api", _max: { updatedAt: daysAgo(3) } }]);
    mockGetPrisma.mockReturnValue({
      organization: { findUnique: vi.fn(async () => ({ id: "org_1" })) },
      repository: {
        findMany: vi.fn(async () => [{ fullName: "acme/api" }, { fullName: "acme/web" }]),
      },
      orgMemory: { groupBy },
    });

    const c = await getMemoryCoverage("acme", { now: NOW });
    expect(c).toMatchObject({ totalTrackedRepos: 2, reposWithFreshMemory: 1, coveragePct: 50 });
    expect(c.staleRepos).toEqual([{ fullName: "acme/web", lastMemoryAt: null }]);

    const where = (groupBy.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ orgId: "org_1", archived: false, supersededBy: null });
    expect(where.namespace).toEqual({ in: ["acme/api", "acme/web"] });
  });

  it("skips the memory read entirely when the org tracks no repos", async () => {
    const groupBy = vi.fn();
    mockGetPrisma.mockReturnValue({
      organization: { findUnique: vi.fn(async () => ({ id: "org_1" })) },
      repository: { findMany: vi.fn(async () => []) },
      orgMemory: { groupBy },
    });
    await expect(getMemoryCoverage("acme", { now: NOW })).resolves.toMatchObject({ coveragePct: 0 });
    expect(groupBy).not.toHaveBeenCalled();
  });
});
