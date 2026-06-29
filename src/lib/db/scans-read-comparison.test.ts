// getScanComparison baseline resolution. The diff renders `after` (target) vs `before` (baseline).
// scans are newest-first, so the default baseline is the scan immediately OLDER than `after`. When
// `after` IS the oldest scan there is no older one — `before` must be null, NOT a forward reach to a
// NEWER scan, which would invert the time axis so every delta reads backward (scan-persistence #5).

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  dbReadSafe: <T,>(fn: () => Promise<T>) => fn(),
}));

vi.mock("@/lib/db/scans-shared", () => ({
  DEFAULT_ORG_SLUG: "public",
  canonicalRepoFullName: (owner: string, name: string) =>
    `${owner.trim().toLowerCase()}/${name.trim().toLowerCase()}`,
  resolveOrgId: vi.fn(async () => "org_1"),
  toPersistedRec: vi.fn(),
  parseStringArray: (): string[] => [],
}));

import { getScanComparison } from "./scans-read";

/** Newest-first scan list rows (HISTORY_POINT_SELECT shape). idA is newest, idC oldest. */
function listRows() {
  return [
    { id: "idA", headSha: "a", overallScore: 80, level: "L3", levelName: "x", confidence: 1, engineProvider: "p", engineModel: "m", scannedAt: new Date("2026-03-03"), dimensions: [] },
    { id: "idB", headSha: "b", overallScore: 70, level: "L2", levelName: "x", confidence: 1, engineProvider: "p", engineModel: "m", scannedAt: new Date("2026-02-02"), dimensions: [] },
    { id: "idC", headSha: "c", overallScore: 60, level: "L1", levelName: "x", confidence: 1, engineProvider: "p", engineModel: "m", scannedAt: new Date("2026-01-01"), dimensions: [] },
  ];
}

/** A ComparableScan-shaped findFirst row for a given id. */
function comparableRow(id: string) {
  return {
    id, scannedAt: new Date("2026-01-01"), overallScore: 60, level: "L1", levelName: "x",
    archetype: "library", adoptionScore: 1, rigorScore: 1, posture: "p", confidence: 1,
    engineProvider: "p", headSha: id, dimensions: [], recommendations: [],
  };
}

function fakePrisma() {
  return {
    repository: { findUnique: vi.fn(async () => ({ id: "repo_1", owner: "o", name: "r", fullName: "o/r", isPrivate: false })) },
    scan: {
      findMany: vi.fn(async () => listRows()),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => comparableRow(where.id)),
    },
  };
}

describe("getScanComparison — baseline never reaches forward in time", () => {
  beforeEach(() => {
    mockGetPrisma.mockReset();
  });

  it("when the requested after is the OLDEST scan, before is null (no axis inversion)", async () => {
    const prisma = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const cmp = await getScanComparison("o", "r", { afterId: "idC" }); // idC is the oldest
    expect(cmp).not.toBeNull();
    expect(cmp!.after?.id).toBe("idC");
    expect(cmp!.before).toBeNull(); // previously fell back to idA (newest) → inverted deltas
    // loadComparableScan was only called for the target, never for a forward baseline.
    expect(prisma.scan.findFirst).toHaveBeenCalledTimes(1);
  });

  it("default after (latest) still diffs against the scan immediately older than it", async () => {
    const prisma = fakePrisma();
    mockGetPrisma.mockReturnValue(prisma);

    const cmp = await getScanComparison("o", "r", {}); // after defaults to idA (newest)
    expect(cmp!.after?.id).toBe("idA");
    expect(cmp!.before?.id).toBe("idB"); // the next-older scan, baseline in the past
  });
});
