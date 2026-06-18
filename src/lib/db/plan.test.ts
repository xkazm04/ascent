// Pins the `db/plan.ts` glue layer — specifically `listGoals`, which performs a *persisted state
// transition inside a read*: when a goal's live fleet value first reaches its target it stamps
// `status="achieved"` + `achievedAt` exactly once (plan.ts:272-275, write at 301-306). The invariant
// that guards `achievedAt` from being re-stamped (and the recorded achievement date corrupted) on
// every subsequent page load is the `g.status === "active"` idempotency guard — pinned here, plus
// the below-target "no write" case and the progress / laggard derivation math.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

import { listGoals } from "./plan";

const ORG_ID = "org_1";
const ORG_SLUG = "acme";

interface GoalSeed {
  id: string;
  metric?: string;
  target: number;
  status?: string; // active | achieved | archived
  achievedAt?: Date | null;
  targetDate?: Date | null;
  label?: string;
  createdAt?: Date;
}

interface RepoSeed {
  fullName: string;
  name: string;
  /** Latest-scan headline scores; omit `scans` entirely to model a never-scanned repo. */
  overall: number;
  adoption?: number;
  rigor?: number;
  dims?: Record<string, number>;
}

/**
 * Fake prisma covering every read `listGoals` issues (organization.findUnique → resolveOrgId,
 * repository.findMany → fleetSnapshot, goal.findMany, and scan/scanDimension.findMany → metricSeries)
 * plus the one write it can emit (goal.update). `goalUpdates` records each achievedAt stamp so the
 * idempotency invariant is observable: a re-stamp would show up as a second update call.
 */
function fakePrisma(opts: { goals: GoalSeed[]; repos?: RepoSeed[] }) {
  const repos = opts.repos ?? [];
  const goalUpdates: Array<{ id: string; data: { status?: string; achievedAt?: Date } }> = [];

  const goalRows = opts.goals.map((g) => ({
    id: g.id,
    orgId: ORG_ID,
    label: g.label ?? `Goal ${g.id}`,
    metric: g.metric ?? "overall",
    target: g.target,
    targetDate: g.targetDate ?? null,
    status: g.status ?? "active",
    achievedAt: g.achievedAt ?? null,
    createdAt: g.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
  }));

  const repoRows = repos.map((r) => ({
    fullName: r.fullName,
    name: r.name,
    scans: [
      {
        overallScore: r.overall,
        adoptionScore: r.adoption ?? r.overall,
        rigorScore: r.rigor ?? r.overall,
        archetype: "org",
        dimensions: Object.entries(r.dims ?? {}).map(([dimId, score]) => ({ dimId, score })),
      },
    ],
  }));

  const prisma = {
    organization: {
      findUnique: vi.fn(async () => ({ id: ORG_ID })),
    },
    repository: {
      findMany: vi.fn(async () => repoRows),
    },
    goal: {
      findMany: vi.fn(async () => goalRows),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { status?: string; achievedAt?: Date } }) => {
        goalUpdates.push({ id: where.id, data });
        return { id: where.id };
      }),
    },
    // metricSeries reads: no scans/dimensions → no fittable trend (pace falls back to "tracking").
    scan: {
      findMany: vi.fn(async () => []),
    },
    scanDimension: {
      findMany: vi.fn(async () => []),
    },
  };

  return { prisma, goalUpdates };
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("listGoals achievedAt state-stamp (the persisted transition inside a read)", () => {
  it("stamps achievedAt ONCE the first time an active goal reaches its target (write fires)", async () => {
    const before = Date.now();
    const { prisma, goalUpdates } = fakePrisma({
      goals: [{ id: "g_active", target: 70, status: "active", achievedAt: null }],
      repos: [{ fullName: "acme/a", name: "a", overall: 80 }], // avg 80 >= target 70 → reached
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await listGoals(ORG_SLUG);
    const after = Date.now();

    expect(out).not.toBeNull();
    const g = out![0]!;
    expect(g.achieved).toBe(true);
    expect(g.status).toBe("achieved");
    expect(g.achievedAt).not.toBeNull();
    // Stamped "now" — falls within the call window.
    const stamped = Date.parse(g.achievedAt!);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);

    // The persisted write fired exactly once with status=achieved + an achievedAt Date.
    expect(prisma.goal.update).toHaveBeenCalledTimes(1);
    expect(goalUpdates).toHaveLength(1);
    expect(goalUpdates[0]!.id).toBe("g_active");
    expect(goalUpdates[0]!.data.status).toBe("achieved");
    expect(goalUpdates[0]!.data.achievedAt).toBeInstanceOf(Date);
  });

  it("does NOT re-stamp a goal already carrying achievedAt (idempotency: no write, original timestamp preserved)", async () => {
    const original = new Date("2026-03-15T09:30:00.000Z");
    const { prisma, goalUpdates } = fakePrisma({
      // status already "achieved" with a recorded date — the g.status === "active" guard must block the re-stamp.
      goals: [{ id: "g_done", target: 70, status: "achieved", achievedAt: original }],
      repos: [{ fullName: "acme/a", name: "a", overall: 95 }], // still >= target, but already achieved
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await listGoals(ORG_SLUG);

    const g = out![0]!;
    expect(g.achieved).toBe(true); // current still >= target
    expect(g.status).toBe("achieved");
    // The ORIGINAL achievement date is preserved verbatim — not moved to "now".
    expect(g.achievedAt).toBe(original.toISOString());

    // No persisted re-stamp: the write does not fire again.
    expect(prisma.goal.update).not.toHaveBeenCalled();
    expect(goalUpdates).toHaveLength(0);
  });

  it("a goal still below target has no achievedAt and triggers no write", async () => {
    const { prisma, goalUpdates } = fakePrisma({
      goals: [{ id: "g_below", target: 70, status: "active", achievedAt: null }],
      repos: [{ fullName: "acme/a", name: "a", overall: 50 }], // avg 50 < target 70
    });
    mockGetPrisma.mockReturnValue(prisma);

    const out = await listGoals(ORG_SLUG);

    const g = out![0]!;
    expect(g.achieved).toBe(false);
    expect(g.status).toBe("active");
    expect(g.achievedAt).toBeNull();
    expect(prisma.goal.update).not.toHaveBeenCalled();
    expect(goalUpdates).toHaveLength(0);
  });
});

describe("listGoals progress / laggard / pct derivation", () => {
  it("computes pct, laggards (worst-first), gap, and belowCount on a crafted fixture", async () => {
    // Fleet avg overall = round((40 + 60 + 80) / 3) = 60; target 80.
    const { prisma } = fakePrisma({
      goals: [{ id: "g1", target: 80, status: "active" }],
      repos: [
        { fullName: "acme/c", name: "c", overall: 80 }, // at target → not a laggard
        { fullName: "acme/a", name: "a", overall: 40 }, // worst
        { fullName: "acme/b", name: "b", overall: 60 },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const g = (await listGoals(ORG_SLUG))![0]!;

    expect(g.current).toBe(60); // round((40+60+80)/3)
    expect(g.target).toBe(80);
    expect(g.pct).toBe(Math.round((60 / 80) * 100)); // 75
    expect(g.achieved).toBe(false);

    // Laggards: repos below 80, sorted ascending by value (worst first), gap = target - value.
    expect(g.laggards.map((l) => l.fullName)).toEqual(["acme/a", "acme/b"]);
    expect(g.laggards.map((l) => l.value)).toEqual([40, 60]);
    expect(g.laggards.map((l) => l.gap)).toEqual([40, 20]);
    expect(g.belowCount).toBe(2); // acme/c at target is excluded
  });

  it("truncates laggards to 12 but belowCount counts the full below set", async () => {
    // 15 repos all below target → all 15 are laggards, list capped at 12, count = 15.
    const repos: RepoSeed[] = Array.from({ length: 15 }, (_, i) => ({
      fullName: `acme/r${String(i).padStart(2, "0")}`,
      name: `r${i}`,
      overall: 10 + i, // 10..24, all < 90
    }));
    const { prisma } = fakePrisma({
      goals: [{ id: "g1", target: 90, status: "active" }],
      repos,
    });
    mockGetPrisma.mockReturnValue(prisma);

    const g = (await listGoals(ORG_SLUG))![0]!;

    expect(g.laggards).toHaveLength(12);
    expect(g.belowCount).toBe(15);
    // Worst-first: lowest score (r00 = 10) leads.
    expect(g.laggards[0]!.fullName).toBe("acme/r00");
  });

  it("target === 0 yields pct === 100 (the divide-by-zero edge) and is treated as reached", async () => {
    const { prisma } = fakePrisma({
      goals: [{ id: "g0", target: 0, status: "active" }],
      repos: [{ fullName: "acme/a", name: "a", overall: 50 }],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const g = (await listGoals(ORG_SLUG))![0]!;

    expect(g.pct).toBe(100);
    expect(g.achieved).toBe(true); // current (50) >= target (0)
  });

  it("with no fittable trend (no scan history) the pace verdict is the neutral 'tracking'", async () => {
    const { prisma } = fakePrisma({
      goals: [{ id: "g1", target: 80, status: "active" }],
      repos: [{ fullName: "acme/a", name: "a", overall: 60 }],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const g = (await listGoals(ORG_SLUG))![0]!;

    expect(g.pace).toBe("tracking");
    expect(g.perWeek).toBe(0);
    expect(g.etaDays).toBeNull();
    expect(g.etaDate).toBeNull();
  });
});
