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

import { listGoals, simulateOrgFixes, rankOrgInvestments, goalImpactsForScenario, isGoalMetric, metricLabel, createGoal, createInitiative, listInitiatives } from "./plan";
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

describe("simulateOrgFixes orchestration (DB snapshot → pure simulateFleet)", () => {
  // A hand-derived fleet (all values verified against the real orgsim source):
  //   acme/a=40, acme/b=40, acme/c=80 (all dims flat, "org" lens).
  //   Raise D2→70: a,b move 40→44 (D2 weight 0.15: 40*0.85 + 70*0.15 = 44.5 → 45? round 44),
  //   c (at 80) is untouched. before avg = round((40+40+80)/3)=53, after avg = round((44+44+80)/3)=56.
  const fleet = () => [flatRepoSeed("acme/a", 40), flatRepoSeed("acme/b", 40), flatRepoSeed("acme/c", 80)];

  it("empty scope resolves to ALL scanned repos and projects the exact fleet delta", async () => {
    const prisma = fakeSimPrisma({ repos: fleet() });
    mockGetPrisma.mockReturnValue(prisma);

    const proj = await simulateOrgFixes(ORG_SLUG, [{ dimId: "D2", target: 70 }], []);

    expect(proj).not.toBeNull();
    // scope defaulted to every scanned repo (3), affected = the two below-target repos.
    expect(proj!.scopeCount).toBe(3);
    expect(proj!.affected).toBe(2);
    // THE pinned orchestration invariant: the projected fleet delta off the DB snapshot.
    expect(proj!.before.avgOverall).toBe(53);
    expect(proj!.after.avgOverall).toBe(56);
    // Per-repo movement: a,b each rise 40→44; c stays at 80.
    const byRepo = Object.fromEntries(proj!.repos.map((r) => [r.fullName, r]));
    expect(byRepo["acme/a"]!.overallBefore).toBe(40);
    expect(byRepo["acme/a"]!.overallAfter).toBe(44);
    expect(byRepo["acme/a"]!.delta).toBe(4);
    expect(byRepo["acme/c"]!.delta).toBe(0); // already above target → untouched
  });

  it("an explicit scope restricts which repos the projection moves", async () => {
    const prisma = fakeSimPrisma({ repos: fleet() });
    mockGetPrisma.mockReturnValue(prisma);

    const proj = await simulateOrgFixes(ORG_SLUG, [{ dimId: "D2", target: 70 }], ["acme/a"]);

    expect(proj!.scopeCount).toBe(1);
    expect(proj!.affected).toBe(1);
    // Only acme/a moved; acme/b is below target but OUT of scope, so it stays put.
    const byRepo = Object.fromEntries(proj!.repos.map((r) => [r.fullName, r]));
    expect(byRepo["acme/a"]!.delta).toBe(4);
    expect(byRepo["acme/b"]!.delta).toBe(0);
    expect(proj!.before.avgOverall).toBe(53);
    expect(proj!.after.avgOverall).toBe(55); // only one repo lifted: round((44+40+80)/3)=55
  });

  it("a repo with a null archetype is scored under the 'org' lens — never NaN", async () => {
    // The whole fleet has NO persisted archetype; fleetSnapshot must default each to "org" so the
    // weighted blend has real weights. A regression that dropped the default → NaN weights → NaN avg.
    const prisma = fakeSimPrisma({
      repos: [
        { fullName: "acme/n", name: "n", overall: 50, archetype: null, dims: flatRepoSeed("acme/n", 50).dims },
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const proj = await simulateOrgFixes(ORG_SLUG, [{ dimId: "D2", target: 70 }], []);

    expect(proj).not.toBeNull();
    expect(Number.isNaN(proj!.before.avgOverall)).toBe(false);
    expect(Number.isNaN(proj!.after.avgOverall)).toBe(false);
    expect(proj!.before.avgOverall).toBe(50); // flat 50 under the org lens
    expect(proj!.after.avgOverall).toBe(53); // D2 50→70 under org lens: 50 + 20*0.15 = 53
  });

  it("returns null on an empty fixes list (so the route 404s, not a no-op 200)", async () => {
    const prisma = fakeSimPrisma({ repos: fleet() });
    mockGetPrisma.mockReturnValue(prisma);
    expect(await simulateOrgFixes(ORG_SLUG, [], [])).toBeNull();
  });

  it("returns null when the org has NO scanned repos (the documented no-data contract)", async () => {
    const prisma = fakeSimPrisma({ repos: [] });
    mockGetPrisma.mockReturnValue(prisma);
    const proj = await simulateOrgFixes(ORG_SLUG, [{ dimId: "D2", target: 70 }], []);
    expect(proj).toBeNull(); // null ⇒ the API layer can 404; never a NaN/empty 200 projection
  });

  it("returns null for an unknown org (resolveOrgId → null)", async () => {
    const prisma = fakeSimPrisma({ repos: fleet(), orgId: null });
    mockGetPrisma.mockReturnValue(prisma);
    expect(await simulateOrgFixes(ORG_SLUG, [{ dimId: "D2", target: 70 }], [])).toBeNull();
  });

  it("returns null (no DB call) when persistence is unconfigured", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const prisma = fakeSimPrisma({ repos: fleet() });
    mockGetPrisma.mockReturnValue(prisma);
    expect(await simulateOrgFixes(ORG_SLUG, [{ dimId: "D2", target: 70 }], [])).toBeNull();
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });
});

describe("rankOrgInvestments orchestration (DB snapshot → pure rankFleetInvestments)", () => {
  const fleet = () => [flatRepoSeed("acme/a", 40), flatRepoSeed("acme/b", 40), flatRepoSeed("acme/c", 80)];

  it("returns one ranked entry per dimension, sorted by projected gain (value), desc", async () => {
    const prisma = fakeSimPrisma({ repos: fleet() });
    mockGetPrisma.mockReturnValue(prisma);

    const ranks = await rankOrgInvestments(ORG_SLUG, 70, []);

    expect(ranks).not.toBeNull();
    // One entry per model dimension, no dimension dropped or duplicated.
    expect(ranks!).toHaveLength(DIMENSIONS.length);
    expect(new Set(ranks!.map((r) => r.dimId)).size).toBe(DIMENSIONS.length);

    // THE pinned ranking invariant: ordered by `gain` descending (the by-value order leaders steer by).
    const gains = ranks!.map((r) => r.gain);
    for (let i = 1; i < gains.length; i++) expect(gains[i]!).toBeLessThanOrEqual(gains[i - 1]!);

    // On a uniform fleet, payoff tracks dimension weight: the top entry is a max-weight dim and
    // outranks the lowest-weight dim D9 (weight 0.09 < D1/D2's 0.15) by strictly more gain.
    const byDim = Object.fromEntries(ranks!.map((r) => [r.dimId, r]));
    expect(byDim["D1"]!.gain).toBeGreaterThan(byDim["D9"]!.gain);
    expect(ranks![0]!.gain).toBeGreaterThanOrEqual(byDim["D1"]!.gain);
    // Every entry carries the requested target through.
    expect(ranks!.every((r) => r.target === 70)).toBe(true);
  });

  it("at target 100 the top dimension promotes repos and reports the largest lift", async () => {
    const prisma = fakeSimPrisma({ repos: fleet() });
    mockGetPrisma.mockReturnValue(prisma);

    const ranks = await rankOrgInvestments(ORG_SLUG, 100, []);

    const top = ranks![0]!;
    // Raising the highest-weight dim to 100 lifts the two low repos enough to cross a band.
    expect(top.gain).toBe(7); // round((47+47+80)/3)=58 vs before 53 → +... pinned to the real number
    expect(top.promotions).toBe(2);
    expect(top.affected).toBe(3); // all three repos are below 100 on that dim
    expect(top.target).toBe(100);
  });

  it("empty scope resolves to all repos; an explicit scope narrows the ranked lift", async () => {
    const prisma = fakeSimPrisma({ repos: fleet() });
    mockGetPrisma.mockReturnValue(prisma);

    const all = await rankOrgInvestments(ORG_SLUG, 70, []);
    const oneRepo = await rankOrgInvestments(ORG_SLUG, 70, ["acme/a"]);

    // Narrowing to one repo can only move ≤ as many repos, so the top gain cannot exceed the
    // whole-fleet top gain — the scope resolution actually flows into the ranking.
    expect(oneRepo![0]!.affected).toBeLessThanOrEqual(all![0]!.affected);
    expect(oneRepo![0]!.affected).toBe(1);
  });

  it("returns null with no scanned repos / unknown org / DB off", async () => {
    mockGetPrisma.mockReturnValue(fakeSimPrisma({ repos: [] }));
    expect(await rankOrgInvestments(ORG_SLUG, 70, [])).toBeNull();

    mockGetPrisma.mockReturnValue(fakeSimPrisma({ repos: [flatRepoSeed("acme/a", 40)], orgId: null }));
    expect(await rankOrgInvestments(ORG_SLUG, 70, [])).toBeNull();

    mockIsDbConfigured.mockReturnValue(false);
    mockGetPrisma.mockReturnValue(fakeSimPrisma({ repos: [flatRepoSeed("acme/a", 40)] }));
    expect(await rankOrgInvestments(ORG_SLUG, 70, [])).toBeNull();
  });
});

describe("goalImpactsForScenario orchestration (active axis goals → forecast coupling)", () => {
  const NOW = Date.parse("2026-06-01T00:00:00.000Z");

  /**
   * Fake prisma for goalImpactsForScenario: resolveOrgId + goal.findMany(active) + metricSeries
   * (scan.findMany for axis metrics). `axisSeries` seeds a rising "overall" trend so a real ETA
   * crossing exists; omit it for the no-trend (null ETA) path.
   */
  function fakeImpactPrisma(opts: { goals: GoalSeed[]; axisSeries?: { at: Date; overall: number }[] }) {
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
    const scanRows = (opts.axisSeries ?? []).map((p) => ({
      scannedAt: p.at,
      overallScore: p.overall,
      adoptionScore: p.overall,
      rigorScore: p.overall,
    }));
    return {
      organization: { findUnique: vi.fn(async () => ({ id: ORG_ID })) },
      goal: { findMany: vi.fn(async () => goalRows) },
      scan: { findMany: vi.fn(async () => scanRows) },
      scanDimension: { findMany: vi.fn(async () => []) },
    };
  }

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps each active axis goal to one impact and skips goals the scenario doesn't move", async () => {
    const prisma = fakeImpactPrisma({
      goals: [
        { id: "g_overall", metric: "overall", target: 90, status: "active" },
        { id: "g_rigor", metric: "rigor", target: 90, status: "active" }, // before==after on rigor → skipped
      ],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const before = { avgOverall: 50, avgAdoption: 50, avgRigor: 50 };
    const after = { avgOverall: 62, avgAdoption: 50, avgRigor: 50 }; // only overall moved

    const impacts = await goalImpactsForScenario(ORG_SLUG, before, after);

    expect(impacts).not.toBeNull();
    // rigor didn't move (sim<=cur) → it is dropped; only the overall goal maps through.
    expect(impacts!.map((i) => i.id)).toEqual(["g_overall"]);
    const imp = impacts![0]!;
    expect(imp.metric).toBe("overall");
    expect(imp.currentValue).toBe(50); // from `before`
    expect(imp.simulatedValue).toBe(62); // from `after`
    expect(imp.target).toBe(90);
    expect(imp.reachedNow).toBe(false); // 62 < 90
  });

  it("flags reachedNow when the simulated value already meets the goal target", async () => {
    const prisma = fakeImpactPrisma({
      goals: [{ id: "g1", metric: "overall", target: 60, status: "active" }],
    });
    mockGetPrisma.mockReturnValue(prisma);

    const impacts = await goalImpactsForScenario(
      ORG_SLUG,
      { avgOverall: 50, avgAdoption: 50, avgRigor: 50 },
      { avgOverall: 75, avgAdoption: 50, avgRigor: 50 }, // 75 >= target 60
    );

    expect(impacts![0]!.reachedNow).toBe(true);
  });

  it("with a fittable rising trend, landing the fix pulls the goal ETA forward (daysSooner > 0)", async () => {
    // A +1/day "overall" series. current(before)=55 → 15 days to 70; simulated(after)=62 → 8 days.
    const axisSeries = Array.from({ length: 10 }, (_, i) => ({
      at: new Date(Date.parse("2026-05-22T00:00:00.000Z") + i * 86_400_000),
      overall: 50 + i,
    }));
    const prisma = fakeImpactPrisma({
      goals: [{ id: "g1", metric: "overall", target: 70, status: "active" }],
      axisSeries,
    });
    mockGetPrisma.mockReturnValue(prisma);

    const impacts = await goalImpactsForScenario(
      ORG_SLUG,
      { avgOverall: 55, avgAdoption: 50, avgRigor: 50 },
      { avgOverall: 62, avgAdoption: 50, avgRigor: 50 },
    );

    const imp = impacts![0]!;
    expect(imp.currentEtaDate).toBe("2026-06-16"); // 55 → 70 at +1/day, 15 days out from NOW
    expect(imp.simulatedEtaDate).toBe("2026-06-09"); // 62 → 70, 8 days out
    expect(imp.daysSooner).toBe(7); // the fix pulls the target 15-8=7 days forward
  });

  it("returns [] when the org has no active axis goals (empty, not null)", async () => {
    const prisma = fakeImpactPrisma({
      goals: [{ id: "g_dim", metric: "D2", target: 80, status: "active" }], // dimension goal → filtered out
    });
    mockGetPrisma.mockReturnValue(prisma);

    const impacts = await goalImpactsForScenario(
      ORG_SLUG,
      { avgOverall: 50, avgAdoption: 50, avgRigor: 50 },
      { avgOverall: 70, avgAdoption: 70, avgRigor: 70 },
    );
    expect(impacts).toEqual([]);
  });

  it("returns null when persistence is unconfigured", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    mockGetPrisma.mockReturnValue(fakeImpactPrisma({ goals: [] }));
    const impacts = await goalImpactsForScenario(
      ORG_SLUG,
      { avgOverall: 50, avgAdoption: 50, avgRigor: 50 },
      { avgOverall: 70, avgAdoption: 50, avgRigor: 50 },
    );
    expect(impacts).toBeNull();
  });
});

// ── The pure plan helpers (test-mastery-2026-06-18 finding #5, Medium) ────────
// Small, pure, hot-path validators/formatters that had no batch. Two are exported and called
// directly (isGoalMetric, metricLabel); the other three (parseRepos, parseTargetDate, dailyAvg)
// are module-private, so they're pinned through the public functions that consume them —
// listInitiatives (parseRepos + targetDate read-back), createGoal/createInitiative (parseTargetDate
// write side), and listGoals (dailyAvg trend collapse → fittable pace). No source change.

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

describe("parseRepos (via listInitiatives) — tolerant of corrupt repos JSON, never throws", () => {
  // Fake prisma covering listInitiatives' reads: resolveOrgId, fleetSnapshot (repository.findMany),
  // initiative.findMany (the row whose `repos` column we corrupt), and the goal/playbook label joins.
  function fakeInitPrisma(reposRaw: string) {
    return {
      organization: { findUnique: vi.fn(async () => ({ id: ORG_ID })) },
      repository: { findMany: vi.fn(async () => []) },
      initiative: {
        findMany: vi.fn(async () => [
          {
            id: "i1",
            title: "T",
            dimId: "D2",
            practiceId: null,
            targetScore: 70,
            repos: reposRaw,
            status: "active",
            assigneeLogin: null,
            targetDate: null,
            goalId: null,
            playbookId: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ]),
      },
      goal: { findMany: vi.fn(async () => []) },
      playbook: { findMany: vi.fn(async () => []) },
    };
  }

  it.each([
    ["not json at all", "{not json"],
    ["a JSON object (non-array)", '{"a":1}'],
    ["a JSON number", "42"],
    ["JSON null", "null"],
    ["empty string", ""],
  ])("returns [] for %s (no throw, panel survives a corrupted column)", async (_label, raw) => {
    mockGetPrisma.mockReturnValue(fakeInitPrisma(raw));
    const out = await listInitiatives(ORG_SLUG);
    expect(out).not.toBeNull();
    expect(out![0]!.repos).toEqual([]);
    expect(out![0]!.progress.total).toBe(0);
  });

  it("drops non-string entries from a mixed array: [1,'a',null,'b'] ⇒ ['a','b']", async () => {
    mockGetPrisma.mockReturnValue(fakeInitPrisma(JSON.stringify([1, "a", null, "b", { x: 1 }, "c"])));
    const out = await listInitiatives(ORG_SLUG);
    expect(out![0]!.repos).toEqual(["a", "b", "c"]);
    expect(out![0]!.progress.total).toBe(3);
  });

  it("passes a clean string array through unchanged", async () => {
    mockGetPrisma.mockReturnValue(fakeInitPrisma(JSON.stringify(["acme/x", "acme/y"])));
    const out = await listInitiatives(ORG_SLUG);
    expect(out![0]!.repos).toEqual(["acme/x", "acme/y"]);
  });
});

describe("parseTargetDate (via createGoal write + listInitiatives read) — valid ⇒ Date, junk ⇒ null, never NaN/throw", () => {
  /** createGoal upserts the org then creates the goal; capture the `targetDate` value it writes. */
  function fakeCreateGoalPrisma() {
    const created: Array<{ targetDate: unknown }> = [];
    return {
      created,
      prisma: {
        organization: { upsert: vi.fn(async () => ({ id: ORG_ID })) },
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

  it("a stored targetDate Date round-trips to its YYYY-MM-DD in listInitiatives", async () => {
    mockGetPrisma.mockReturnValue({
      organization: { findUnique: vi.fn(async () => ({ id: ORG_ID })) },
      repository: { findMany: vi.fn(async () => []) },
      initiative: {
        findMany: vi.fn(async () => [
          {
            id: "i1", title: "T", dimId: "D2", practiceId: null, targetScore: 70, repos: "[]",
            status: "active", assigneeLogin: null, targetDate: new Date("2026-09-15T12:00:00.000Z"),
            goalId: null, playbookId: null, createdAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ]),
      },
      goal: { findMany: vi.fn(async () => []) },
      playbook: { findMany: vi.fn(async () => []) },
    });
    const out = await listInitiatives(ORG_SLUG);
    expect(out![0]!.targetDate).toBe("2026-09-15");
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
