// Pins the `db/plan.ts` glue layer — specifically `listGoals`, which performs a *persisted state
// transition inside a read*: when a goal's live fleet value first reaches its target it stamps
// `status="achieved"` + `achievedAt` exactly once (plan.ts:272-275, write at 301-306). The invariant
// that guards `achievedAt` from being re-stamped (and the recorded achievement date corrupted) on
// every subsequent page load is the `g.status === "active"` idempotency guard — pinned here, plus
// the below-target "no write" case and the progress / laggard derivation math.
//
// ALSO pins the *what-if simulator orchestration* (test-mastery-2026-06-18 finding #2, High): the
// DB-glue functions `simulateOrgFixes`, `rankOrgInvestments`, and `goalImpactsForScenario` read the
// fleet snapshot / active goals from Prisma and feed the PURE simulator math (orgsim.ts) + goal
// projector (forecast.ts). The pure leaves are covered in orgsim.test.ts / forecast.test.ts; here we
// mock the readers and let the real math run, pinning the glue: archetype defaulting, empty-scope →
// all-scanned-repos resolution, the documented null-on-no-data path (so the route 404s), the
// projected fleet delta, the by-value investment ranking, and the per-scenario goal-impact mapping.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
}));

import { listGoals, isGoalMetric, metricLabel, createGoal, updateGoal } from "./plan";
import { DIMENSIONS, DIMENSION_BY_ID } from "@/lib/maturity/model";

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

  it("REVERTS an 'achieved' goal to 'active' (clearing achievedAt) once the fleet regresses below target", async () => {
    // goals-initiatives #1: the transition is symmetric. A goal that was achieved and has since
    // backslid must not latch "🎉 Achieved" forever — it returns to the active list showing the slide.
    const original = new Date("2026-03-15T09:30:00.000Z");
    const { prisma, goalUpdates } = fakePrisma({
      goals: [{ id: "g_done", target: 70, status: "achieved", achievedAt: original }],
      repos: [{ fullName: "acme/a", name: "a", overall: 50 }], // avg 50 < target 70 → regressed
    });
    mockGetPrisma.mockReturnValue(prisma);

    const g = (await listGoals(ORG_SLUG))![0]!;
    expect(g.achieved).toBe(false); // live value is below target
    expect(g.status).toBe("active"); // the latched "achieved" is reverted, not kept
    expect(g.achievedAt).toBeNull(); // the stale first-reached date is cleared

    // The revert is persisted exactly once: status back to active, achievedAt nulled.
    expect(prisma.goal.update).toHaveBeenCalledTimes(1);
    expect(goalUpdates).toHaveLength(1);
    expect(goalUpdates[0]!.id).toBe("g_done");
    expect(goalUpdates[0]!.data.status).toBe("active");
    expect(goalUpdates[0]!.data.achievedAt).toBeNull();
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

// ── What-if simulator orchestration (finding #2, High) ───────────────────────
// simulateOrgFixes / rankOrgInvestments read fleetSnapshot from Prisma then run the PURE
// simulateFleet / rankFleetInvestments. We mock the readers (resolveOrgId + repository.findMany)
// and let the real math run, pinning the GLUE: scope resolution, archetype defaulting, the
// null-on-no-data contract, and the exact projected delta / ranking the real pure layer produces.

const ALL_DIMS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"] as const;

/** A repo seed with every dimension at one flat score — under the "org" lens recompute === flat. */
function flatRepoSeed(fullName: string, score: number, archetype = "org"): SimRepoSeed {
  const dims: Record<string, number> = {};
  for (const d of ALL_DIMS) dims[d] = score;
  return { fullName, name: fullName.split("/")[1] ?? fullName, overall: score, archetype, dims };
}

interface SimRepoSeed {
  fullName: string;
  name: string;
  overall: number;
  /** null models a scan that never persisted an archetype → must default to "org". */
  archetype?: string | null;
  dims: Record<string, number>;
}

/**
 * Fake prisma for the simulator orchestration: covers `resolveOrgId` (organization.findUnique) and
 * `fleetSnapshot` (repository.findMany). `orgId: null` models an unknown org (resolveOrgId → null).
 */
function fakeSimPrisma(opts: { repos: SimRepoSeed[]; orgId?: string | null }) {
  const orgId = opts.orgId === undefined ? ORG_ID : opts.orgId;
  const repoRows = opts.repos.map((r) => ({
    fullName: r.fullName,
    name: r.name,
    scans: [
      {
        overallScore: r.overall,
        adoptionScore: r.overall,
        rigorScore: r.overall,
        archetype: r.archetype === undefined ? "org" : r.archetype,
        dimensions: Object.entries(r.dims).map(([dimId, score]) => ({ dimId, score })),
      },
    ],
  }));
  return {
    organization: { findUnique: vi.fn(async () => (orgId ? { id: orgId } : null)) },
    repository: { findMany: vi.fn(async () => repoRows) },
  };
}

describe("isGoalMetric — accepts exactly {overall, adoption, rigor, D1..D9}, rejects the rest", () => {
  const VALID = ["overall", "adoption", "rigor", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"];

  it.each(VALID)("accepts the valid metric id %s", (m) => {
    expect(isGoalMetric(m)).toBe(true);
  });

  // The drift invariant: the accepted dimension set is EXACTLY the model's dimensions — no more, no less.
  it("accepts every model DimensionId and no phantom dimension", () => {
    for (const d of DIMENSIONS) expect(isGoalMetric(d.id)).toBe(true);
    expect(DIMENSIONS.map((d) => d.id).sort()).toEqual(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"]);
  });

  it.each(["D0", "D10", "D99", "", "overall ", " overall", "Overall", "OVERALL", "adoption2", "dimension", "d1", "rigour"])(
    "rejects the junk id %j",
    (m) => {
      expect(isGoalMetric(m)).toBe(false);
    },
  );
});

describe("metricLabel — friendly labels for axes, model name for dimensions, raw-id fallback", () => {
  it("maps the three axis metrics to their friendly labels", () => {
    expect(metricLabel("overall")).toBe("Overall maturity");
    expect(metricLabel("adoption")).toBe("AI Adoption");
    expect(metricLabel("rigor")).toBe("Engineering Rigor");
  });

  // Each dimension id resolves to the model's name — pinning that label and model stay IN SYNC.
  it.each(DIMENSIONS.map((d) => [d.id, d.name] as const))("metricLabel(%s) === the model's '%s'", (id, name) => {
    expect(metricLabel(id)).toBe(name);
    expect(metricLabel(id)).toBe(DIMENSION_BY_ID[id].name);
  });

  it("D2 specifically returns the model's 'Automated Testing' (a concrete sync anchor)", () => {
    expect(metricLabel("D2")).toBe("Automated Testing");
  });

  it("echoes an unknown id back verbatim as a safe fallback (never throws / never undefined)", () => {
    expect(metricLabel("D10")).toBe("D10");
    expect(metricLabel("bogus")).toBe("bogus");
    expect(metricLabel("")).toBe("");
  });
});

describe("parseTargetDate (via createGoal write) — valid ⇒ Date, junk ⇒ null, never NaN/throw", () => {
  /** createGoal upserts the org, reads the fleet snapshot (already-met guard), then creates the goal;
   *  capture the `targetDate` value it writes. `repos` seeds the snapshot (default: scan-less fleet). */
  function fakeCreateGoalPrisma(repos: RepoSeed[] = []) {
    const created: Array<{ targetDate: unknown }> = [];
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
    return {
      created,
      prisma: {
        organization: { upsert: vi.fn(async () => ({ id: ORG_ID })) },
        repository: { findMany: vi.fn(async () => repoRows) },
        goal: {
          create: vi.fn(async ({ data }: { data: { targetDate: unknown } }) => {
            created.push({ targetDate: data.targetDate });
            return { id: "g_new" };
          }),
        },
      },
    };
  }

  it.each([
    ["a valid ISO date", "2026-12-31", "2026-12-31"],
    ["a full ISO datetime", "2026-06-01T00:00:00.000Z", "2026-06-01"],
  ])("%s is parsed to a Date carrying the right calendar day", async (_label, input, isoDay) => {
    const { prisma, created } = fakeCreateGoalPrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await createGoal(ORG_SLUG, { label: "G", metric: "overall", target: 70, targetDate: input });
    const td = created[0]!.targetDate as Date;
    expect(td).toBeInstanceOf(Date);
    expect(Number.isNaN(td.getTime())).toBe(false);
    expect(td.toISOString().slice(0, 10)).toBe(isoDay);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["non-date text", "not-a-date"],
  ])("%s parses to null (open-ended goal, never an Invalid Date)", async (_label, input) => {
    const { prisma, created } = fakeCreateGoalPrisma();
    mockGetPrisma.mockReturnValue(prisma);
    await createGoal(ORG_SLUG, { label: "G", metric: "overall", target: 70, targetDate: input as string | null });
    expect(created[0]!.targetDate).toBeNull();
  });

  // ambiguity-ui 07-16 goals #5: pct has no baseline, so a target the fleet already meets would be
  // stamped "achieved" (zero-movement milestone) on the very next listGoals pass — reject at create.
  describe("createGoal already-met guard", () => {
    it("rejects target <= the fleet's current value with GOAL_ALREADY_MET naming the current number", async () => {
      const { prisma } = fakeCreateGoalPrisma([{ fullName: "acme/web", name: "web", overall: 47 }]);
      mockGetPrisma.mockReturnValue(prisma);
      await expect(createGoal(ORG_SLUG, { label: "G", metric: "overall", target: 47 })).rejects.toMatchObject({
        code: "GOAL_ALREADY_MET",
        message: expect.stringContaining("already at 47"),
      });
      expect(prisma.goal.create).not.toHaveBeenCalled();
    });

    it("allows a target above the current value, and any target on a scan-less fleet (metrics read 0)", async () => {
      const fleet = fakeCreateGoalPrisma([{ fullName: "acme/web", name: "web", overall: 47 }]);
      mockGetPrisma.mockReturnValue(fleet.prisma);
      await expect(createGoal(ORG_SLUG, { label: "G", metric: "overall", target: 48 })).resolves.toEqual({ id: "g_new" });

      const empty = fakeCreateGoalPrisma();
      mockGetPrisma.mockReturnValue(empty.prisma);
      await expect(createGoal(ORG_SLUG, { label: "G", metric: "overall", target: 10 })).resolves.toEqual({ id: "g_new" });
    });
  });

});

describe("dailyAvg (via listGoals trend) — collapses same-day points to a per-day mean, sorted ascending", () => {
  // Many scans on the same calendar day must collapse to ONE per-day mean; two days of clearly
  // different means produce a fittable rising/flat trend. A regression in the collapse or the
  // ascending sort would change the slope the goal projector fits — observable as a different pace.
  function fakeTrendPrisma(scans: { at: string; overall: number }[]) {
    return {
      organization: { findUnique: vi.fn(async () => ({ id: ORG_ID })) },
      repository: {
        findMany: vi.fn(async () => [
          { fullName: "acme/a", name: "a", scans: [{ overallScore: 60, adoptionScore: 60, rigorScore: 60, archetype: "org", dimensions: [] }] },
        ]),
      },
      goal: {
        findMany: vi.fn(async () => [
          { id: "g1", orgId: ORG_ID, label: "G", metric: "overall", target: 90, targetDate: null, status: "active", achievedAt: null, createdAt: new Date("2026-01-01T00:00:00.000Z") },
        ]),
      },
      scan: {
        findMany: vi.fn(async () =>
          scans.map((s) => ({ scannedAt: new Date(s.at), overallScore: s.overall, adoptionScore: s.overall, rigorScore: s.overall })),
        ),
      },
      scanDimension: { findMany: vi.fn(async () => []) },
    };
  }

  it("a single day of duplicate points yields no fittable slope (one collapsed point → flat 'tracking')", async () => {
    // Three readings on ONE day collapse to a single mean point; one point can't define a slope.
    const prisma = fakeTrendPrisma([
      { at: "2026-05-01T01:00:00.000Z", overall: 40 },
      { at: "2026-05-01T09:00:00.000Z", overall: 60 },
      { at: "2026-05-01T18:00:00.000Z", overall: 80 }, // same-day mean = 60
    ]);
    // patch the update fn the real listGoals may call (goal already not reached → it won't, but be safe)
    (prisma.goal as { update?: unknown }).update = vi.fn(async () => ({ id: "g1" }));
    mockGetPrisma.mockReturnValue(prisma);

    const g = (await listGoals(ORG_SLUG))![0]!;
    // With a single collapsed day there's no trend to fit → neutral pace, no ETA.
    expect(g.pace).toBe("tracking");
    expect(g.perWeek).toBe(0);
    expect(g.etaDays).toBeNull();
  });

  it("a clear rising day-over-day mean yields a positive trend (perWeek > 0, an ETA exists)", async () => {
    // Day 1 mean ≈ 50, then a strictly rising mean each day for two weeks → positive slope.
    const scans = Array.from({ length: 14 }, (_, d) => ({
      at: `2026-05-${String(d + 1).padStart(2, "0")}T06:00:00.000Z`,
      overall: 50 + d * 2, // rises 2/day across distinct days
    }));
    // add a same-day duplicate on day 1 that must be averaged in (50 and 54 → mean 52, still rising)
    scans.push({ at: "2026-05-01T20:00:00.000Z", overall: 54 });
    const prisma = fakeTrendPrisma(scans);
    (prisma.goal as { update?: unknown }).update = vi.fn(async () => ({ id: "g1" }));
    mockGetPrisma.mockReturnValue(prisma);

    const g = (await listGoals(ORG_SLUG))![0]!;
    // The collapse + ascending sort produced a fittable upward trend the projector can read.
    expect(g.perWeek).toBeGreaterThan(0);
    expect(g.trajectory.length).toBeGreaterThan(0);
    expect(g.etaDays).not.toBeNull();
    expect(g.etaDays!).toBeGreaterThan(0);
  });
});

// ── updateGoal / updateInitiative — optimistic compare-and-set (goals-initiatives #1) ──────────────
// Goal & Initiative have NO updatedAt/version column and the schema is frozen, so the lost-update guard
// is a value-compare (compare-and-set), mirroring updateRecommendation: the write lands as a conditional
// `updateMany` keyed on the last-seen value of ONLY the fields being changed — the editor's `expected`
// value when supplied, else the server pre-image read moments earlier. A concurrent write to one of THIS
// patch's own fields makes updateMany match 0 rows → a tagged GOAL_CONFLICT / INIT_CONFLICT the route
// maps to 409, so a deliberate retarget/relabel is never silently clobbered; editing DIFFERENT fields
// never conflicts. An unknown id throws P2025 (route → 404).

/**
 * A fake `goal`/`initiative` model whose `updateMany` models the DB's conditional match: every guard
 * field in the `where` (besides `id`) must equal the ACTUAL stored row (`stored`) for the update to
 * land. `current` is what the pre-update `findUnique` returns (the read pre-image); pass a different
 * `stored` to model a concurrent write that committed between the read and the update.
 */
function fakeCasModel(opts: { current: Record<string, unknown> | null; stored?: Record<string, unknown> }) {
  const stored = opts.stored ?? opts.current ?? {};
  const findUnique = vi.fn(async () => opts.current);
  const updateMany = vi.fn(async ({ where }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const norm = (x: unknown) => (x instanceof Date ? x.getTime() : x);
    const match = Object.entries(where).every(([k, v]) => k === "id" || norm((stored as Record<string, unknown>)[k]) === norm(v));
    return { count: match ? 1 : 0 };
  });
  return { findUnique, updateMany };
}

describe("updateGoal — optimistic compare-and-set", () => {
  const base = { status: "active", target: 50, label: "old", targetDate: null };

  it("returns false and touches nothing when the DB is not configured", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await updateGoal("g1", { target: 80 })).toBe(false);
  });

  it("applies the change guarding each written field on the server pre-image (no expected supplied)", async () => {
    const model = fakeCasModel({ current: { ...base } });
    mockGetPrisma.mockReturnValue({ goal: model });

    expect(await updateGoal("g1", { target: 80, label: "new" })).toBe(true);
    // The conditional update guards ONLY the fields it writes (target, label), keyed on the pre-image,
    // with the normalized new values in `data` — never the untouched status/targetDate.
    expect(model.updateMany).toHaveBeenCalledTimes(1);
    const call = model.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "g1", target: 50, label: "old" });
    expect(call.data).toEqual({ target: 80, label: "new" });
  });

  it("GOAL_CONFLICT when a concurrent write changed a field this patch also writes", async () => {
    // Read saw target 50; by update time another admin set it to 80 → the pre-image guard misses.
    const model = fakeCasModel({ current: { ...base, target: 50 }, stored: { ...base, target: 80 } });
    mockGetPrisma.mockReturnValue({ goal: model });

    await expect(updateGoal("g1", { target: 90 })).rejects.toMatchObject({ code: "GOAL_CONFLICT" });
  });

  it("honors a client `expected` snapshot: a stale editor's write is rejected even after a fresh read", async () => {
    // DB already at 80 (another admin moved it); this editor last saw 50 and sends expected.target=50.
    const model = fakeCasModel({ current: { ...base, target: 80 }, stored: { ...base, target: 80 } });
    mockGetPrisma.mockReturnValue({ goal: model });

    await expect(updateGoal("g1", { target: 90 }, { target: 50 })).rejects.toMatchObject({ code: "GOAL_CONFLICT" });
    // The guard used the CLIENT's last-seen value (50), not the fresh pre-image (80).
    expect(model.updateMany.mock.calls[0][0].where).toMatchObject({ target: 50 });
  });

  it("does NOT conflict when a concurrent edit touched a DIFFERENT field", async () => {
    // This patch writes label; another admin changed status. Guarding only label → still matches.
    const model = fakeCasModel({ current: { ...base }, stored: { ...base, status: "achieved" } });
    mockGetPrisma.mockReturnValue({ goal: model });

    expect(await updateGoal("g1", { label: "renamed" })).toBe(true);
    expect(model.updateMany.mock.calls[0][0].where).toEqual({ id: "g1", label: "old" });
  });

  it("throws P2025 (route → 404) when the goal id is unknown, without an update", async () => {
    const model = fakeCasModel({ current: null });
    mockGetPrisma.mockReturnValue({ goal: model });

    await expect(updateGoal("ghost", { target: 80 })).rejects.toMatchObject({ code: "P2025" });
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it("is a no-op (true, no update) for an empty patch once existence is confirmed", async () => {
    const model = fakeCasModel({ current: { ...base } });
    mockGetPrisma.mockReturnValue({ goal: model });

    expect(await updateGoal("g1", {})).toBe(true);
    expect(model.updateMany).not.toHaveBeenCalled();
  });
});

describe("listGoals — the display trend series attached to each goal", () => {
  it("attaches the metric's per-day series (retention-clamped, ≤90 points) to the goal row", async () => {
    const { prisma } = fakePrisma({
      goals: [{ id: "g1", metric: "overall", target: 90 }],
      repos: [{ fullName: "acme/api", name: "api", overall: 50 }],
    });
    const day = 86_400_000;
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * day);
    // Two recent observations inside every plan's retention floor, one ancient one outside the
    // default (free ⇒ 30d) window — the clamp must drop it from the DISPLAY series.
    prisma.scan.findMany = vi.fn(async () => [
      { scannedAt: at(400), overallScore: 10, adoptionScore: 10, rigorScore: 10 },
      { scannedAt: at(5), overallScore: 48, adoptionScore: 40, rigorScore: 55 },
      { scannedAt: at(1), overallScore: 52, adoptionScore: 44, rigorScore: 60 },
    ]) as never;
    mockGetPrisma.mockReturnValue(prisma);

    const g = (await listGoals(ORG_SLUG))![0]!;
    expect(g.series.map((p) => p.value)).toEqual([48, 52]);
    expect(g.series.length).toBeLessThanOrEqual(90);
    // Chronological, ISO-dated points — the shape GoalTrend draws.
    expect(g.series[0]!.date < g.series[1]!.date).toBe(true);
  });

  it("is an empty series (not a crash, not undefined) when the org has no scans", async () => {
    const { prisma } = fakePrisma({ goals: [{ id: "g1", target: 80 }] });
    mockGetPrisma.mockReturnValue(prisma);
    const g = (await listGoals(ORG_SLUG))![0]!;
    expect(g.series).toEqual([]);
  });
});
