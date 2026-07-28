// The two invariants the PUBLIC register exists to hold, pinned at the seam:
//
//  1. A PRIVATE repo never reaches a public surface — not through the register, not through an
//     owner's scorecard — even when the query layer hands one back (the legacy-row / went-private
//     case the badge route already defends against).
//  2. A MOCK-engine scan is never ranked against a model-scored one; it is carried out separately
//     and flagged, so a caller cannot render it as a rating by accident.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockResolveOrgId, scanFindMany, repoFindMany, repoCount } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockResolveOrgId: vi.fn(async () => "org-public"),
  scanFindMany: vi.fn(),
  repoFindMany: vi.fn(),
  repoCount: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: () => ({
    scan: { findMany: scanFindMany },
    repository: { findMany: repoFindMany, count: repoCount },
  }),
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if ((err as { name?: string })?.name === "PrismaClientInitializationError") return fallback;
      throw err;
    }
  },
}));

vi.mock("@/lib/db/scans-shared", () => ({
  DEFAULT_ORG_SLUG: "public",
  canonicalRepoFullName: (o: string, n: string) => `${o}/${n}`.toLowerCase(),
  parseStringArray: () => [],
  toPersistedRec: vi.fn(),
  resolveOrgId: mockResolveOrgId,
}));

import { getPublicOrgScorecard, getPublicRegister, registerEntryFrom } from "./data";

type Row = Parameters<typeof registerEntryFrom>[0];

function repoRow(
  over: Partial<{
    id: string;
    owner: string;
    name: string;
    fullName: string;
    isPrivate: boolean;
    stars: number;
    overall: number;
    engineProvider: string;
    scannedAt: string;
  }> = {},
): Row {
  const owner = over.owner ?? "acme";
  const name = over.name ?? "api";
  return {
    id: over.id ?? `${owner}-${name}`,
    owner,
    name,
    fullName: over.fullName ?? `${owner}/${name}`,
    isPrivate: over.isPrivate ?? false,
    primaryLanguage: "TypeScript",
    stars: over.stars ?? 10,
    scans: [
      {
        headSha: "abc1234",
        overallScore: over.overall ?? 70,
        level: "L3",
        levelName: "Established",
        adoptionScore: 60,
        rigorScore: 80,
        engineProvider: over.engineProvider ?? "anthropic",
        scannedAt: new Date(over.scannedAt ?? "2026-07-20T00:00:00.000Z"),
        dimensions: [
          { dimId: "D1", score: over.overall ?? 70 },
          { dimId: "D9", score: 50 },
        ],
      },
    ],
  } as unknown as Row;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockResolveOrgId.mockResolvedValue("org-public");
  repoCount.mockResolvedValue(3);
});

describe("registerEntryFrom — the per-row privacy enforcement point", () => {
  it("refuses a PRIVATE repo even when the query returned it", () => {
    expect(registerEntryFrom(repoRow({ isPrivate: true }))).toBeNull();
  });

  it("publishes a public repo and flags its provenance", () => {
    const real = registerEntryFrom(repoRow({ engineProvider: "anthropic" }));
    const mock = registerEntryFrom(repoRow({ engineProvider: "mock" }));
    expect(real?.verified).toBe(true);
    expect(mock?.verified).toBe(false);
    expect(mock?.engineProvider).toBe("mock");
  });
});

describe("getPublicRegister — tenancy", () => {
  it("scopes BOTH queries to the public org AND isPrivate:false", async () => {
    scanFindMany.mockResolvedValue([{ repoId: "acme-api" }]);
    repoFindMany.mockResolvedValue([repoRow()]);

    await getPublicRegister();

    const scanWhere = scanFindMany.mock.calls[0]![0].where;
    expect(scanWhere.repo).toMatchObject({ orgId: "org-public", isPrivate: false });
    const repoWhere = repoFindMany.mock.calls[0]![0].where;
    expect(repoWhere).toMatchObject({ orgId: "org-public", isPrivate: false });
  });

  it("drops a private row that slipped past the where clause (defense in depth)", async () => {
    scanFindMany.mockResolvedValue([{ repoId: "a" }, { repoId: "b" }]);
    repoFindMany.mockResolvedValue([
      repoRow({ id: "a", name: "public-api", overall: 80 }),
      // A legacy / went-private row persisted under the public org. The board must not carry it.
      repoRow({ id: "b", name: "secret-api", overall: 99, isPrivate: true }),
    ]);

    const reg = await getPublicRegister();

    const names = [...(reg?.entries ?? []), ...(reg?.unverified ?? [])].map((e) => e.fullName);
    expect(names).toEqual(["acme/public-api"]);
    expect(JSON.stringify(reg)).not.toContain("secret-api");
  });
});

describe("getPublicRegister — provenance", () => {
  it("never ranks a mock score against a model score", async () => {
    scanFindMany.mockResolvedValue([{ repoId: "a" }, { repoId: "b" }]);
    repoFindMany.mockResolvedValue([
      // The mock entry scores HIGHER — if provenance were ignored it would top the board.
      repoRow({ id: "b", name: "demo", overall: 99, engineProvider: "mock" }),
      repoRow({ id: "a", name: "real", overall: 71, engineProvider: "anthropic" }),
    ]);

    const reg = await getPublicRegister();

    expect(reg?.entries.map((e) => e.fullName)).toEqual(["acme/real"]);
    expect(reg?.entries.every((e) => e.verified)).toBe(true);
    expect(reg?.unverified.map((e) => e.fullName)).toEqual(["acme/demo"]);
    expect(reg?.totalVerified).toBe(1);
  });

  it("paginates the ranked board and keeps the unranked tail on page 1 only", async () => {
    scanFindMany.mockResolvedValue([{ repoId: "a" }, { repoId: "b" }, { repoId: "c" }]);
    repoFindMany.mockResolvedValue([
      repoRow({ id: "a", name: "one", overall: 90 }),
      repoRow({ id: "b", name: "two", overall: 80 }),
      repoRow({ id: "c", name: "demo", overall: 95, engineProvider: "mock" }),
    ]);

    const p1 = await getPublicRegister({ page: 1, perPage: 1 });
    expect(p1?.entries.map((e) => e.fullName)).toEqual(["acme/one"]);
    expect(p1?.unverified).toHaveLength(1);
    expect(p1?.totalPages).toBe(2);

    const p2 = await getPublicRegister({ page: 2, perPage: 1 });
    expect(p2?.entries.map((e) => e.fullName)).toEqual(["acme/two"]);
    expect(p2?.unverified).toEqual([]);
  });
});

describe("getPublicOrgScorecard", () => {
  it("narrows to the owner's public repos and averages MODEL-SCORED repos only", async () => {
    scanFindMany.mockResolvedValue([{ repoId: "a" }, { repoId: "b" }]);
    repoFindMany.mockResolvedValue([
      repoRow({ id: "a", name: "one", overall: 80 }),
      repoRow({ id: "b", name: "demo", overall: 20, engineProvider: "mock" }),
    ]);

    const card = await getPublicOrgScorecard("ACME");

    // Owner narrowing is expressed on the canonical lowercase fullName prefix.
    expect(scanFindMany.mock.calls[0]![0].where.repo.fullName).toEqual({ startsWith: "acme/" });
    expect(card?.repoCount).toBe(2);
    expect(card?.verifiedCount).toBe(1);
    // 20 (mock) never drags the published average down — only the model-scored 80 counts.
    expect(card?.avgOverall).toBe(80);
    expect(card?.owner).toBe("acme");
  });

  it("reports verifiedCount 0 when every scan was a mock preview (no number to publish)", async () => {
    scanFindMany.mockResolvedValue([{ repoId: "a" }]);
    repoFindMany.mockResolvedValue([repoRow({ id: "a", engineProvider: "mock" })]);

    const card = await getPublicOrgScorecard("acme");
    expect(card?.verifiedCount).toBe(0);
    expect(card?.avgOverall).toBe(0);
  });

  it("never returns a private repo for an owner", async () => {
    scanFindMany.mockResolvedValue([{ repoId: "a" }]);
    repoFindMany.mockResolvedValue([repoRow({ id: "a", name: "secret", isPrivate: true })]);

    await expect(getPublicOrgScorecard("acme")).resolves.toBeNull();
  });

  it("rejects a slash-bearing owner segment instead of prefix-matching across owners", async () => {
    await expect(getPublicOrgScorecard("acme/api")).resolves.toBeNull();
    expect(scanFindMany).not.toHaveBeenCalled();
  });
});
