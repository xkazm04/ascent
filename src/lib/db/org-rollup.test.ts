// Critical coverage gap (test-mastery-2026-06-18, org-overview-standing #1): computeWindowDeltas is
// the cohort-matched period delta behind the dashboard's headline "net maturity ▲" tile, the
// per-tile period deltas, the "Quarter in review" banner, and the weekly digest number — and it had
// ZERO tests despite a code comment documenting the exact past bug it exists to prevent: onboarding
// low-scoring repos mid-quarter used to read as the whole fleet "slipping" ~25 points that no
// individual repo experienced (and onboarding strong repos manufactured a fake climb). The entire
// reason the function exists is the cohort-intersection invariant — movement is measured ONLY over
// repos present on BOTH sides of the window — so that is what these tests lock in.
//
// The function is pure; it takes plain RepoScoreSnap arrays and needs no DB. The mock below keeps the
// module import side-effect-free (defensive — the client is only touched inside the async query
// functions, not at module load) so this suite never reaches for a database.

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetPrisma, mockIsDbConfigured } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockIsDbConfigured: vi.fn(() => false),
}));

vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: mockIsDbConfigured }));

import { computeWindowDeltas, computeDimDeltas, getOrgRollup, type RepoScoreSnap, type RepoDimSnap } from "@/lib/db/org-rollup";

/** Terse snapshot builder: same overall/adoption/rigor unless overridden. */
function snap(repoId: string, overall: number, adoption = overall, rigor = overall): RepoScoreSnap {
  return { repoId, overall, adoption, rigor };
}

describe("computeWindowDeltas — cohort matching", () => {
  it("measures only repos present in BOTH windows (real before->after delta)", () => {
    // A and B exist on both sides; their real movement is A 70->80 (+10), B 80->90 (+10).
    const current = [snap("A", 80), snap("B", 90)];
    const baseline = [snap("A", 70), snap("B", 80)];
    expect(computeWindowDeltas(current, baseline)).toEqual({
      overall: 10,
      adoption: 10,
      rigor: 10,
    });
  });

  it("EXCLUDES a newly-onboarded repo (after-only) — no fabricated fleet slip", () => {
    // THE DOCUMENTED BUG. A=70->80 and B=80->90 (both +10); C is brand new this window at 10.
    // Averaging the whole current fleet [80,90,10]=60 against the baseline cohort [70,80]=75 would
    // report a phantom -15 "slip" that no repo experienced. The cohort intersection must drop C and
    // report the true +10 the matched repos actually moved.
    const current = [snap("A", 80), snap("B", 90), snap("C", 10)];
    const baseline = [snap("A", 70), snap("B", 80)];
    const result = computeWindowDeltas(current, baseline);
    expect(result).toEqual({ overall: 10, adoption: 10, rigor: 10 });
    // Explicitly: the onboarded low-scorer did NOT drag the headline negative.
    expect(result!.overall).toBeGreaterThan(0);
  });

  it("EXCLUDES a strong newly-onboarded repo too — no fabricated fleet climb", () => {
    // Symmetric guard: a high-scoring new repo must not manufacture a fake climb either.
    // Matched cohort A,B is flat (70->70, 80->80) => +0; the new C=100 must not inflate it.
    const current = [snap("A", 70), snap("B", 80), snap("C", 100)];
    const baseline = [snap("A", 70), snap("B", 80)];
    expect(computeWindowDeltas(current, baseline)).toEqual({ overall: 0, adoption: 0, rigor: 0 });
  });

  it("EXCLUDES a dropped repo (before-only) — it leaves the cohort, not the math", () => {
    // D was scored in the baseline but is gone from the current window. The cohort is just A,B,
    // moving 70->80 and 80->90 (+10). D's baseline 0 must not be averaged into the "before" side.
    const current = [snap("A", 80), snap("B", 90)];
    const baseline = [snap("A", 70), snap("B", 80), snap("D", 0)];
    expect(computeWindowDeltas(current, baseline)).toEqual({
      overall: 10,
      adoption: 10,
      rigor: 10,
    });
  });

  it("tracks each dimension's cohort delta independently", () => {
    // overall/adoption/rigor are averaged and differenced per-dimension, not collapsed.
    const current = [snap("A", 80, 60, 40), snap("B", 90, 50, 30)];
    const baseline = [snap("A", 70, 50, 50), snap("B", 80, 40, 30)];
    expect(computeWindowDeltas(current, baseline)).toEqual({
      overall: 10, // avg(80,90)=85 - avg(70,80)=75
      adoption: 10, // avg(60,50)=55 - avg(50,40)=45
      rigor: -5, // avg(40,30)=35 - avg(50,30)=40
    });
  });
});

describe("computeWindowDeltas — no-overlap / empty windows", () => {
  it("returns null when the cohorts don't overlap at all", () => {
    // current C,D vs baseline A,B — no shared repoId, so there is no movement to report.
    const current = [snap("C", 50), snap("D", 60)];
    const baseline = [snap("A", 70), snap("B", 80)];
    expect(computeWindowDeltas(current, baseline)).toBeNull();
  });

  it("returns null when the current window is empty", () => {
    expect(computeWindowDeltas([], [snap("A", 70)])).toBeNull();
  });

  it("returns null when the baseline window is empty", () => {
    expect(computeWindowDeltas([snap("A", 70)], [])).toBeNull();
  });

  it("returns null when both windows are empty (no NaN, no throw)", () => {
    expect(computeWindowDeltas([], [])).toBeNull();
  });

  it("returns a zero delta (never NaN) for an unchanged overlapping cohort", () => {
    const same = [snap("A", 70), snap("B", 80)];
    const result = computeWindowDeltas(same, same.map((s) => ({ ...s })));
    expect(result).toEqual({ overall: 0, adoption: 0, rigor: 0 });
    expect(Number.isNaN(result!.overall)).toBe(false);
  });
});

describe("computeWindowDeltas — rounding", () => {
  it("rounds each cohort AVERAGE before differencing (Math.round, not the raw mean)", () => {
    // avg(70,71)=70.5 -> Math.round -> 71; baseline avg(70,70)=70. Delta is +1, not +0.5.
    const current = [snap("A", 70), snap("B", 71)];
    const baseline = [snap("A", 70), snap("B", 70)];
    expect(computeWindowDeltas(current, baseline)!.overall).toBe(1);
  });

  it("differences the two rounded averages (each side rounded independently)", () => {
    // now avg(70,71)=70.5->71 ; before avg(60,61)=60.5->61 ; delta 71-61 = 10.
    const current = [snap("A", 70), snap("B", 71)];
    const baseline = [snap("A", 60), snap("B", 61)];
    expect(computeWindowDeltas(current, baseline)!.overall).toBe(10);
  });
});

// ── computeDimDeltas — the per-dimension sibling (Security tab's "D9 vs 90d ago") ──────────────
// Same cohort-intersection invariant as computeWindowDeltas, plus two dim-specific rules:
// a dimension present on only ONE side is omitted (no fake movement when D9 is introduced
// mid-window), and within the cohort a repo missing a dim simply doesn't vote on it.

/** Terse dim-snapshot builder: dims as [dimId, score] pairs. */
function dsnap(repoId: string, ...dims: [string, number][]): RepoDimSnap {
  return { repoId, dims: dims.map(([dimId, score]) => ({ dimId, score })) };
}

describe("computeDimDeltas — cohort matching per dimension", () => {
  it("measures only repos present in BOTH windows, per dimId", () => {
    // Cohort A,B: D1 moves avg(80,90)=85 - avg(70,80)=75 = +10; D9 moves avg(40,60)=50 - avg(20,40)=30 = +20.
    // C is after-only and must not vote.
    const current = [dsnap("A", ["D1", 80], ["D9", 40]), dsnap("B", ["D1", 90], ["D9", 60]), dsnap("C", ["D1", 10], ["D9", 5])];
    const baseline = [dsnap("A", ["D1", 70], ["D9", 20]), dsnap("B", ["D1", 80], ["D9", 40])];
    expect(computeDimDeltas(current, baseline)).toEqual([
      { dimId: "D1", delta: 10 },
      { dimId: "D9", delta: 20 },
    ]);
  });

  it("omits a dimension that exists on only one side (introduced mid-window)", () => {
    // D9 was added to the rubric after the baseline scans — no before-side, so no movement claim.
    const current = [dsnap("A", ["D1", 80], ["D9", 50])];
    const baseline = [dsnap("A", ["D1", 70])];
    expect(computeDimDeltas(current, baseline)).toEqual([{ dimId: "D1", delta: 10 }]);
  });

  it("a cohort repo missing a dim doesn't vote on it (no zero-fill drag)", () => {
    // B has no D9 on either side; D9's delta is A's alone: 60-20 = +40 (not averaged against a fake 0).
    const current = [dsnap("A", ["D9", 60]), dsnap("B", ["D1", 80])];
    const baseline = [dsnap("A", ["D9", 20]), dsnap("B", ["D1", 80])];
    expect(computeDimDeltas(current, baseline)).toEqual([
      { dimId: "D1", delta: 0 },
      { dimId: "D9", delta: 40 },
    ]);
  });

  it("returns null when the cohorts don't overlap (and on empty sides)", () => {
    expect(computeDimDeltas([dsnap("C", ["D1", 50])], [dsnap("A", ["D1", 70])])).toBeNull();
    expect(computeDimDeltas([], [dsnap("A", ["D1", 70])])).toBeNull();
    expect(computeDimDeltas([dsnap("A", ["D1", 70])], [])).toBeNull();
  });

  it("rounds each side's average independently before differencing (mirrors computeWindowDeltas)", () => {
    // now avg(70,71)=70.5->71 ; before avg(70,70)=70 ; delta +1.
    const current = [dsnap("A", ["D9", 70]), dsnap("B", ["D9", 71])];
    const baseline = [dsnap("A", ["D9", 70]), dsnap("B", ["D9", 70])];
    expect(computeDimDeltas(current, baseline)).toEqual([{ dimId: "D9", delta: 1 }]);
  });
});

// ── getOrgRollup — baseline query shape + local-day trend (fleet-rollups-insights #1, #2) ──────────
// Integration-ish coverage over the real query pipeline (real org-shared / forecast / parsers, a faked
// prisma, mirroring org-signals.test.ts): the pre-window baseline query must fetch ONE row per repo at
// the DB (distinct), not the org's whole pre-window history; and the maturity trend must bucket by LOCAL
// calendar day (the same zone the window snaps to), collapsing multiple same-day scans to one point.

describe("getOrgRollup — baseline query shape + local-day trend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDbConfigured.mockReturnValue(true);
  });

  const localDayKey = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  /** One repo row with a single latest scan, shaped as getOrgRollup's include reads it. */
  function repoRow(id: string, scannedAt: Date) {
    return {
      id, fullName: `acme/${id}`, owner: "acme", name: id, isPrivate: false, watched: true,
      primaryLanguage: "TypeScript", techStackJson: null, passportJson: null, passportOverridesJson: null,
      scanSchedule: "manual", lastScanAt: null, lastScanStatus: "ok", lastScanError: null, aiConformance: null,
      scans: [{
        level: "L3", overallScore: 70, adoptionScore: 60, rigorScore: 80, posture: "ai-native",
        scannedAt, engineProvider: "anthropic", governance: null, commitActivity: null, prStats: null,
        dimensions: [{ dimId: "D1", score: 70 }],
      }],
    };
  }

  /** scan.findMany is called twice (trend, then the distinct baseline); branch on the `distinct` arg. */
  function fakePrisma(trendScans: { scannedAt: Date; overallScore: number }[]) {
    const scanFindMany = vi.fn(async (args: { distinct?: unknown } = {}) =>
      args.distinct
        ? [{ id: "s_base", repoId: "r1", overallScore: 50, adoptionScore: 50, rigorScore: 50 }]
        : trendScans,
    );
    const prisma = {
      organization: { findUnique: vi.fn(async () => ({ id: "org_1", plan: "enterprise", slug: "acme" })) },
      repository: { findMany: vi.fn(async () => [repoRow("r1", new Date("2026-05-12T12:00:00Z"))]) },
      scan: { findMany: scanFindMany },
      scanDimension: { findMany: vi.fn(async () => []) },
    };
    return { prisma, scanFindMany };
  }

  it("issues the pre-window baseline query with distinct:['repoId'] — one row per repo at the DB (fleet-rollups-insights #1)", async () => {
    const { prisma, scanFindMany } = fakePrisma([{ scannedAt: new Date("2026-05-12T12:00:00Z"), overallScore: 70 }]);
    mockGetPrisma.mockReturnValue(prisma);

    // A window `start` triggers the baseline branch.
    const start = new Date("2026-05-01T00:00:00Z");
    await getOrgRollup("acme", { start });

    const baselineCall = scanFindMany.mock.calls.map((c) => c[0]).find((a) => a?.distinct) as
      | { distinct: unknown; where: { scannedAt: unknown } }
      | undefined;
    expect(baselineCall, "the baseline scan.findMany should carry distinct").toBeDefined();
    expect(baselineCall!.distinct).toEqual(["repoId"]);
    // Half-open baseline: strictly before `start`.
    expect(baselineCall!.where.scannedAt).toEqual({ lt: start });
  });

  it("buckets the maturity trend by LOCAL calendar day, collapsing same-day scans to one averaged point (fleet-rollups-insights #2)", async () => {
    // Two scans on one local day + one on a later day. Expected buckets are computed with the SAME local-day
    // grouping the code uses, so this holds in any timezone AND catches a regression to UTC-day bucketing
    // wherever the run zone isn't UTC.
    const rows = [
      { scannedAt: new Date("2026-05-10T11:00:00Z"), overallScore: 60 },
      { scannedAt: new Date("2026-05-10T13:00:00Z"), overallScore: 80 },
      { scannedAt: new Date("2026-05-12T12:00:00Z"), overallScore: 90 },
    ];
    const { prisma } = fakePrisma(rows);
    mockGetPrisma.mockReturnValue(prisma);

    const res = await getOrgRollup("acme");

    const byDay: Record<string, number[]> = {};
    for (const r of rows) (byDay[localDayKey(r.scannedAt)] ??= []).push(r.overallScore);
    const expected = Object.keys(byDay)
      .sort()
      .map((date) => ({ date, avg: Math.round(byDay[date]!.reduce((a, b) => a + b, 0) / byDay[date]!.length) }));

    expect(res!.trend).toEqual(expected); // same-day pair collapses to one point (avg 70)
  });
});
