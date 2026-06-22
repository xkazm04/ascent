// Unit test for compareTechStacks (3b-P2 tech-stacks comparison page). getOrgRollup is mocked so this
// pins the comparison wiring: keyA/keyB resolve to the org's groups, each side is summarized from its
// scoped rollup, and the pure buildSegmentComparison produces a − b headline + per-dimension deltas.
// keyB=null compares against the whole fleet; an unknown keyA returns null.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetPrisma, mockGetOrgRollup } = vi.hoisted(() => ({ mockGetPrisma: vi.fn(), mockGetOrgRollup: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgRollup: mockGetOrgRollup }));

import { compareTechStacks } from "@/lib/db/tech-groups";

function fakePrisma(groups: { id: string; key: string; label: string; members: number }[]) {
  return {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1" })) },
    techStackGroup: {
      findMany: vi.fn(async () => groups.map((g) => ({ id: g.id, key: g.key, label: g.label, _count: { members: g.members } }))),
    },
  };
}

const rollup = (over: Record<string, unknown>) => ({
  repoCount: 2,
  scannedCount: 2,
  avgOverall: 70,
  avgAdoption: 60,
  avgRigor: 50,
  dimAverages: [{ dimId: "D1", avg: 80 }],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("compareTechStacks", () => {
  it("compares two stacks by key (a − b), reusing each side's scoped rollup", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([
      { id: "g_fe", key: "frontend", label: "Frontend", members: 3 },
      { id: "g_be", key: "backend:python", label: "Backend · Python", members: 2 },
    ]));
    mockGetOrgRollup.mockImplementation(async (_slug: string, _win: unknown, _seg: unknown, techGroupId: string | null) =>
      techGroupId === "g_fe"
        ? rollup({ avgOverall: 80, avgAdoption: 75, avgRigor: 60, dimAverages: [{ dimId: "D1", avg: 85 }] })
        : rollup({ avgOverall: 65, avgAdoption: 55, avgRigor: 45, dimAverages: [{ dimId: "D1", avg: 60 }] }),
    );
    const c = await compareTechStacks("acme", "frontend", "backend:python");
    expect(c).not.toBeNull();
    expect(c!.a.name).toBe("Frontend");
    expect(c!.b.name).toBe("Backend · Python");
    expect(c!.deltas.overall).toBe(15); // 80 − 65
    expect(c!.dimDeltas[0]).toMatchObject({ dimId: "D1", a: 85, b: 60, delta: 25 });
  });

  it("compares a single stack against the whole fleet when keyB is null", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([{ id: "g_fe", key: "frontend", label: "Frontend", members: 3 }]));
    mockGetOrgRollup.mockImplementation(async (_slug: string, _win: unknown, _seg: unknown, techGroupId: string | null) =>
      techGroupId === "g_fe" ? rollup({ avgOverall: 80 }) : rollup({ avgOverall: 70 }),
    );
    const c = await compareTechStacks("acme", "frontend", null);
    expect(c!.a.name).toBe("Frontend");
    expect(c!.b.name).toBe("Whole fleet");
    expect(c!.deltas.overall).toBe(10);
  });

  it("returns null when keyA isn't a (non-empty) group of the org", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([{ id: "g_fe", key: "frontend", label: "Frontend", members: 3 }]));
    expect(await compareTechStacks("acme", "bogus", null)).toBeNull();
  });
});
