// MOONSHOT #33 — the ledger's two db-shaped invariants, over a mocked Prisma:
//   · a re-apply UPSERTS on the 4-tuple (org, repo, practice, artifactPath) and never resets a live
//     `adopted`/`drifted` row back to `proposed` — that would discard the landed baseline drift is
//     measured against, or silently answer a finding the user has not decided;
//   · a second identical mine creates NO new HousePatternVersion.
// Plus the pure summary fold, whose honest-null rule (a null patternVersion is "not version-tracked",
// never "v0 / behind") is the one a reader is most likely to break.

import { beforeEach, describe, expect, it, vi } from "vitest";

const practiceAdoption = {
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
};
const housePatternVersion = { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() };
const improvementPr = { findMany: vi.fn() };

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({ practiceAdoption, housePatternVersion, improvementPr }),
}));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: async () => ({ id: "org1", slug: "acme" }) }));

const shapes = vi.fn();
vi.mock("@/lib/db/org-practice-shapes", () => ({ getOrgPracticeShapes: () => shapes() }));

import { foldAdoptionSummary, recordProposedAdoption, type PracticeAdoptionRow } from "./practice-adoption";
import { syncHousePatternVersions } from "./house-pattern-versions";

const base = {
  orgId: "org1",
  repoFullName: "acme/api",
  practiceId: "agent-guidance",
  source: "house" as const,
  patternVersion: 2,
  artifactPath: "AGENTS.md",
  proposedHash: "sha256-n1:p",
  prNumber: 7,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordProposedAdoption", () => {
  it("creates one row keyed on the 4-tuple when none exists", async () => {
    practiceAdoption.findUnique.mockResolvedValue(null);
    await recordProposedAdoption(base);
    expect(practiceAdoption.create).toHaveBeenCalledTimes(1);
    expect(practiceAdoption.create.mock.calls[0]![0].data).toMatchObject({
      orgId: "org1",
      repoFullName: "acme/api",
      practiceId: "agent-guidance",
      artifactPath: "AGENTS.md",
      patternVersion: 2,
    });
  });

  it("updates in place on a re-apply — idempotent on the 4-tuple, never a second row", async () => {
    practiceAdoption.findUnique.mockResolvedValue({ state: "adopted" });
    await recordProposedAdoption({ ...base, patternVersion: 3 });
    expect(practiceAdoption.create).not.toHaveBeenCalled();
    const data = practiceAdoption.update.mock.calls[0]![0].data;
    expect(data.patternVersion).toBe(3);
    // The landed baseline survives: no state reset, so `adoptedHash` still measures drift.
    expect(data.state).toBeUndefined();
  });

  it("does not answer an undecided drift finding by resetting the row", async () => {
    practiceAdoption.findUnique.mockResolvedValue({ state: "drifted" });
    await recordProposedAdoption(base);
    expect(practiceAdoption.update.mock.calls[0]![0].data.state).toBeUndefined();
  });

  it("re-opens a removed row as proposed", async () => {
    practiceAdoption.findUnique.mockResolvedValue({ state: "removed" });
    await recordProposedAdoption(base);
    expect(practiceAdoption.update.mock.calls[0]![0].data.state).toBe("proposed");
  });

  // The PR already exists on GitHub by the time this runs; a throw would send the caller to retry and
  // open a duplicate.
  it("never throws when the write fails", async () => {
    practiceAdoption.findUnique.mockRejectedValue(new Error("db down"));
    await expect(recordProposedAdoption(base)).resolves.toBeUndefined();
  });
});

describe("syncHousePatternVersions", () => {
  const dims = (n: number) => Object.fromEntries(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"].map((d) => [d, n]));
  const source = {
    repoFullName: "acme/api",
    dims: dims(90),
    shape: { version: "2" as const, entries: [{ practiceId: "agent-guidance", path: "AGENTS.md", outline: ["# A", "## B"], layout: [] }] },
  };
  // Two exemplars (MIN_AGREEMENT = 2 — one repo's document is not a house pattern) plus a gap repo,
  // without which the mine is not `offerable` and correctly yields no pattern to version.
  const twoRepos = [
    source,
    { ...source, repoFullName: "acme/web" },
    { ...source, repoFullName: "acme/legacy", dims: dims(10) },
  ];

  it("appends v1 for a freshly mined pattern", async () => {
    shapes.mockResolvedValue(twoRepos);
    housePatternVersion.findUnique.mockResolvedValue(null);
    housePatternVersion.findFirst.mockResolvedValue(null);
    housePatternVersion.create.mockResolvedValue({});
    expect(await syncHousePatternVersions("acme")).toBe(1);
    expect(housePatternVersion.create.mock.calls[0]![0].data.version).toBe(1);
  });

  // The point of hashing the lines: a nightly rescan of an unchanged fleet must not build a version
  // ladder that makes every repo look perpetually behind.
  it("writes NOTHING on a second identical mine", async () => {
    shapes.mockResolvedValue(twoRepos);
    housePatternVersion.findUnique.mockResolvedValue({ id: "hp1" });
    expect(await syncHousePatternVersions("acme")).toBe(0);
    expect(housePatternVersion.create).not.toHaveBeenCalled();
  });

  it("writes no row at all for an org that mines nothing — absence, not a v0", async () => {
    shapes.mockResolvedValue([{ ...source, dims: dims(10) }]);
    housePatternVersion.findUnique.mockResolvedValue(null);
    expect(await syncHousePatternVersions("acme")).toBe(0);
    expect(housePatternVersion.create).not.toHaveBeenCalled();
  });
});

describe("foldAdoptionSummary", () => {
  const row = (over: Partial<PracticeAdoptionRow>): PracticeAdoptionRow => ({
    id: "a",
    repoFullName: "acme/api",
    practiceId: "agent-guidance",
    source: "house",
    patternVersion: 1,
    artifactPath: "AGENTS.md",
    state: "adopted",
    prNumber: null,
    adoptedAt: null,
    driftedAt: null,
    lastCheckedAt: null,
    ...over,
  });

  it("renders nothing for an empty ledger", () => {
    expect(foldAdoptionSummary([], {})).toMatchObject({ total: 0, adoptedRepos: 0, widestGap: null });
  });

  it("counts a house row on an older version as behind, with the version span", () => {
    const s = foldAdoptionSummary([row({}), row({ id: "b", repoFullName: "acme/web" })], { "agent-guidance": 3 });
    expect(s.behindRepos).toBe(2);
    expect(s.widestGap).toEqual({ practiceId: "agent-guidance", fromVersion: 1, toVersion: 3, repos: 2 });
  });

  // THE honest null. `patternVersion: null` means "this source is not version-tracked" — a generic or
  // registry starter has no house version to be behind of, and reading the null as 0 would report the
  // entire fleet as behind the moment an org mined its first pattern.
  it("never reads a null patternVersion as v0 / behind", () => {
    const s = foldAdoptionSummary(
      [row({ source: "generic", patternVersion: null }), row({ id: "c", source: "registry", patternVersion: null })],
      { "agent-guidance": 4 },
    );
    expect(s.behindRepos).toBe(0);
    expect(s.widestGap).toBeNull();
    expect(s.adoptedRepos).toBe(1);
  });

  it("is not behind when the org has no pattern for that practice at all", () => {
    expect(foldAdoptionSummary([row({})], {}).behindRepos).toBe(0);
  });

  it("counts drifted and removed together as repos needing a decision", () => {
    const s = foldAdoptionSummary([row({ state: "drifted" }), row({ id: "d", repoFullName: "acme/web", state: "removed" })], {});
    expect(s.driftedRepos).toBe(2);
    expect(s.perPractice["agent-guidance"]).toEqual({ adopted: 0, behind: 0, drifted: 2 });
  });
});
