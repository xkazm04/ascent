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
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";

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
    confidence: number;
    prStats: string | null;
    rubricVersion: string | null;
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
        confidence: over.confidence ?? 0.85,
        rubricVersion: "rubricVersion" in over ? over.rubricVersion : SCORING_RUBRIC_VERSION,
        prStats: "prStats" in over ? over.prStats : JSON.stringify({ merged: 12 }),
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

describe("registerEntryFrom — honesty fields for the public surface", () => {
  it("carries the scan's confidence verbatim", () => {
    expect(registerEntryFrom(repoRow({ confidence: 0.62 }))?.confidence).toBe(0.62);
  });

  it("reads a window with merged PRs as having process signals", () => {
    expect(registerEntryFrom(repoRow())?.hasProcessSignals).toBe(true);
  });

  it("reads a mirror-shaped window (PRs exist, none merged), an absent slice, and a malformed slice all as no signal", () => {
    // The real mirror shape: drive-by PRs accumulate and close unmerged (sqlite: 46 total, 0 merged).
    expect(
      registerEntryFrom(repoRow({ prStats: JSON.stringify({ totalCount: 46, merged: 0 }) }))?.hasProcessSignals,
    ).toBe(false);
    expect(registerEntryFrom(repoRow({ prStats: null }))?.hasProcessSignals).toBe(false);
    expect(registerEntryFrom(repoRow({ prStats: "{not json" }))?.hasProcessSignals).toBe(false);
  });
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

// UAT `TOMAS-L1-11`. The register's PROVENANCE invariant was written for the engine and not extended
// to the rubric, while `model.ts` states plainly that two rubric versions' numbers are not comparable
// and a bump invalidates the cache WITHOUT re-scanning. The qualifier is a chip, not a de-rank.
describe("registerEntryFrom — the rubric is a provenance qualifier", () => {
  it("carries the rubric the scan was taken under", () => {
    expect(registerEntryFrom(repoRow({ rubricVersion: "r10" }))?.rubricVersion).toBe("r10");
  });

  it("marks a scan taken under the CURRENT rubric as current", () => {
    const e = registerEntryFrom(repoRow({ rubricVersion: SCORING_RUBRIC_VERSION }));
    expect(e?.currentRubric).toBe(true);
  });

  it("marks an earlier rubric as NOT current, while leaving it verified and rankable", () => {
    const e = registerEntryFrom(repoRow({ rubricVersion: "r10" }));
    expect(e?.currentRubric).toBe(false);
    // Deliberately unlike a mock row: a stale score is a real rating on an earlier instrument.
    expect(e?.verified).toBe(true);
  });

  it("treats a MISSING rubric as unknown, and unknown is not current", () => {
    // The same reading db/outcomes.ts gives it when it refuses to pair two scans.
    const e = registerEntryFrom(repoRow({ rubricVersion: null }));
    expect(e?.rubricVersion).toBeNull();
    expect(e?.currentRubric).toBe(false);
  });
});
