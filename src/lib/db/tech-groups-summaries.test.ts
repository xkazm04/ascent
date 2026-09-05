// Unit tests for listTechStackSummaries (3b-P2 /tech-stacks per-stack matrix). getOrgRollup is mocked
// so this pins the property the optimization exists for: the page issues ONE fleet rollup regardless of
// how many tech groups the org has (it used to run a full getOrgRollup PER GROUP, sequentially). The
// per-group numbers are pinned alongside it, since a single-pass reduction is only worth having if it
// reproduces the group-scoped rollup's arithmetic exactly.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockGetPrisma, mockGetOrgRollup } = vi.hoisted(() => ({ mockGetPrisma: vi.fn(), mockGetOrgRollup: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgRollup: mockGetOrgRollup, getOrgId: vi.fn(async () => "org_1") }));

import { listTechStackSummaries } from "@/lib/db/tech-groups";

const repo = (fullName: string, overall: number, adoption: number, rigor: number, d1: number) => ({
  fullName,
  latest: { overall, adoption, rigor, dims: [{ dimId: "D1", score: d1 }] },
});

function fakePrisma(
  groups: { id: string; key: string; label: string; members: number }[],
  memberships: { groupId: string; fullName: string }[],
) {
  return {
    techStackGroup: {
      findMany: vi.fn(async () => groups.map((g) => ({ id: g.id, key: g.key, label: g.label, _count: { members: g.members } }))),
    },
    techStackGroupMember: {
      findMany: vi.fn(async () => memberships.map((m) => ({ groupId: m.groupId, repo: { fullName: m.fullName } }))),
    },
  };
}

const GROUPS = [
  { id: "g_fe", key: "frontend", label: "Frontend", members: 2 },
  { id: "g_be", key: "backend:python", label: "Backend · Python", members: 1 },
  { id: "g_mo", key: "mobile", label: "Mobile", members: 1 },
];

const MEMBERSHIPS = [
  { groupId: "g_fe", fullName: "acme/web" },
  { groupId: "g_fe", fullName: "acme/admin" },
  { groupId: "g_be", fullName: "acme/api" },
  { groupId: "g_mo", fullName: "acme/ios" },
];

const REPOS = [
  repo("acme/web", 80, 70, 60, 90),
  repo("acme/admin", 60, 50, 40, 70),
  repo("acme/api", 50, 40, 30, 55),
  repo("acme/ios", 40, 30, 20, 45),
];

function mockFleetRollup(repos: unknown[] = REPOS) {
  mockGetOrgRollup.mockResolvedValue({ repoCount: repos.length, repos });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPrisma.mockReturnValue(fakePrisma(GROUPS, MEMBERSHIPS));
});

describe("listTechStackSummaries", () => {
  it("issues exactly ONE fleet rollup regardless of tech-group count", async () => {
    mockFleetRollup();
    await listTechStackSummaries("acme", { includeFleet: true });
    // 3 groups + the whole-fleet baseline used to be 4 full-fleet rollups.
    expect(mockGetOrgRollup).toHaveBeenCalledTimes(1);
    // …and it is the UNSCOPED fleet rollup (no segment / tech-group filter pushed into the query).
    const [slug, , segmentId, groupId] = mockGetOrgRollup.mock.calls[0]!;
    expect(slug).toBe("acme");
    expect(segmentId ?? null).toBeNull();
    expect(groupId ?? null).toBeNull();
  });

  it("stays at one rollup as groups grow (the N+1 cannot creep back)", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, key: `k${i}`, label: `L${i}`, members: 1 }));
    mockGetPrisma.mockReturnValue(fakePrisma(many, many.map((g) => ({ groupId: g.id, fullName: "acme/web" }))));
    mockFleetRollup();
    const out = await listTechStackSummaries("acme");
    expect(out).toHaveLength(12);
    expect(mockGetOrgRollup).toHaveBeenCalledTimes(1);
  });

  it("derives per-group numbers by partitioning the one rollup's repos", async () => {
    mockFleetRollup();
    const out = await listTechStackSummaries("acme", { includeFleet: true });
    expect(out!.map((s) => s.id)).toEqual([null, "frontend", "backend:python", "mobile"]);

    const fleet = out![0]!;
    expect(fleet.name).toBe("Whole fleet");
    expect(fleet.repoCount).toBe(4);
    expect(fleet.scannedCount).toBe(4);
    expect(fleet.avgOverall).toBe(58); // (80+60+50+40)/4 = 57.5 → 58
    expect(fleet.dimAverages).toEqual([{ dimId: "D1", avg: 65 }]);

    const fe = out![1]!;
    expect(fe.name).toBe("Frontend");
    expect(fe.repoCount).toBe(2);
    expect(fe.avgOverall).toBe(70); // (80+60)/2
    expect(fe.avgAdoption).toBe(60);
    expect(fe.avgRigor).toBe(50);
    expect(fe.dimAverages).toEqual([{ dimId: "D1", avg: 80 }]);

    const be = out![2]!;
    expect(be.repoCount).toBe(1);
    expect(be.avgOverall).toBe(50);
    expect(be.dimAverages).toEqual([{ dimId: "D1", avg: 55 }]);
  });

  it("hides empty groups (listTechStackGroups' rule) and yields a zeroed summary for a group with no rolled-up repos", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma(
        [...GROUPS, { id: "g_lib", key: "library", label: "Library", members: 0 }],
        // g_be's only member isn't in the rollup universe (unwatched + never scanned).
        MEMBERSHIPS.filter((m) => m.groupId !== "g_be").concat({ groupId: "g_be", fullName: "acme/ghost" }),
      ),
    );
    mockFleetRollup();
    const out = await listTechStackSummaries("acme");
    expect(out!.map((s) => s.id)).toEqual(["frontend", "backend:python", "mobile"]); // no "library"
    expect(out![1]).toMatchObject({ id: "backend:python", repoCount: 0, scannedCount: 0, avgOverall: 0 });
  });

  it("returns [] when there is nothing to roll up", async () => {
    mockGetOrgRollup.mockResolvedValue(null);
    expect(await listTechStackSummaries("acme", { includeFleet: true })).toEqual([]);
  });
});
