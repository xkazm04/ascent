// The "Copy for LLM" payload is a product contract — a dev pastes it into Claude Code. Lock its
// shape: standing headline, benchmark, strengths/weaknesses, movement, and a trailing actionable ASK.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { briefingMarkdown, engineMixDegraded, valueRealizedLine, type ExecBriefing } from "./briefing";

// `buildExecBriefing` is pure assembly over five @/lib/db reads (rollup/benchmark/movers/goals +
// a prior-window rollup it derives itself). Mock the db boundary so we can drive the assembly math
// directly and pin its invariants. The real maturity model (DIMENSION_BY_ID / levelForScore) and the
// real forecast serializer stay un-mocked so labels/levels are asserted against production data.
vi.mock("@/lib/db", () => ({
  getOrgRollup: vi.fn(),
  getOrgBenchmark: vi.fn(),
  getOrgMovers: vi.fn(),
  listGoals: vi.fn(),
}));

// buildExecBriefing reads the engine mix through the @/lib/db/org barrel (the same barrel every
// sibling rollup goes through), so stub it here too — otherwise the real query reaches for a
// database and the assembly hangs.
vi.mock("@/lib/db/org", () => ({
  getOrgEngineMix: vi.fn(async () => []),
  getOrgRecsActioned: vi.fn(async () => ({ engaged: 0, actioned: 0 })),
}));

const fixture: ExecBriefing = {
  org: "acme",
  periodTitle: "last 30 days",
  generatedOn: "2026-06-09",
  maturity: { overall: 62, levelId: "L3", levelName: "Managed", adoption: 58, rigor: 66 },
  coverage: { scanned: 8, total: 12 },
  periodDelta: 4,
  priorPeriod: {
    overall: 58,
    adoption: 54,
    rigor: 62,
    dOverall: 4,
    dAdoption: 4,
    dRigor: 4,
    dims: [{ dimId: "D2", label: "Test Discipline", now: 60, prior: 52, delta: 8 }],
  },
  forecastHeadline: "On track to reach L4 in 6 weeks.",
  forecastConfidence: 80,
  engineMix: [
    { provider: "claude-cli", count: 7 },
    { provider: "mock", count: 1 },
  ],
  valueRealized: { recsEngaged: 5, recsActioned: 3, pointsMoved: 4, reposPromoted: 2 },
  adoptionRate: 58,
  movement: { up: 5, down: 2, compared: 8 },
  benchmark: {
    percentile: 71,
    corpusRepos: 240,
    corpusAvgOverall: 54,
    cohort: { language: "TypeScript", repos: 60, overallPercentile: 68, adoptionPercentile: 55 },
  },
  strengths: [{ dimId: "D2", label: "Testing", avg: 80 }],
  risks: [{ dimId: "D9", label: "Security", avg: 41 }],
  security: { dimId: "D9", label: "Security", avg: 41 },
  topGainers: [{ name: "api", dOverall: 9, levelFrom: "L2", levelTo: "L3" }],
  topRegressions: [{ name: "legacy", dOverall: -5, levelFrom: "L3", levelTo: "L3" }],
  goals: [{ label: "Lift security", current: 41, target: 70, pct: 22, pace: "behind", etaDays: 120 }],
  regressionCount: 1,
};

describe("valueRealizedLine — the renewal-justification, only when there's value to show", () => {
  it("prefers completed over engaged, and joins points + promotions", () => {
    expect(valueRealizedLine({ recsEngaged: 5, recsActioned: 3, pointsMoved: 4, reposPromoted: 2 })).toBe(
      "3 recommendations completed · fleet +4 pts · 2 repos leveled up",
    );
  });
  it("falls back to 'actioned' when nothing was completed, and singularizes", () => {
    expect(valueRealizedLine({ recsEngaged: 1, recsActioned: 0, pointsMoved: null, reposPromoted: 1 })).toBe(
      "1 recommendation actioned · 1 repo leveled up",
    );
  });
  it("is null when nothing measurable happened (no empty 0·0·0 line)", () => {
    expect(valueRealizedLine({ recsEngaged: 0, recsActioned: 0, pointsMoved: 0, reposPromoted: 0 })).toBeNull();
    expect(valueRealizedLine({ recsEngaged: 0, recsActioned: 0, pointsMoved: null, reposPromoted: 0 })).toBeNull();
  });
});

describe("engineMixDegraded — flags a PARTIAL mock fallback, not a clean single-engine period", () => {
  it("is true only when mock AND a real engine both scored in the period", () => {
    expect(engineMixDegraded([{ provider: "claude-cli", count: 7 }, { provider: "mock", count: 1 }])).toBe(true);
    expect(engineMixDegraded([{ provider: "claude-cli", count: 8 }])).toBe(false); // all live
    expect(engineMixDegraded([{ provider: "mock", count: 8 }])).toBe(false); // all mock (a demo/mock deployment, not a fallback)
    expect(engineMixDegraded([])).toBe(false);
  });
});

describe("briefingMarkdown", () => {
  const md = briefingMarkdown(fixture);

  it("leads with the standing headline incl. level and period delta", () => {
    expect(md).toContain("Overall maturity: **62/100** (L3 Managed) (+4 vs last 30 days start)");
    expect(md).toContain("Coverage: 8/12 repositories scanned");
  });

  it("includes benchmark, strengths, weakest dims, trajectory and movement", () => {
    expect(md).toContain("71th percentile vs 240 repos");
    expect(md).toContain("Peer cohort (TypeScript): 68th percentile overall vs 60 TypeScript repos; 55th on AI adoption");
    expect(md).toContain("Trajectory: On track to reach L4 in 6 weeks. (trend confidence 80%)");
    expect(md).toContain("D2 Testing: 80/100");
    expect(md).toContain("D9 Security: 41/100");
    expect(md).toMatch(/▲ api: \+9 \(L2→L3\)/);
    expect(md).toMatch(/▼ legacy: -5(?!\s*\()/); // no level transition shown when from === to
  });

  it("renders goals with progress + ETA", () => {
    expect(md).toContain("Lift security: 41/70 (22%, behind, ETA ~120d)");
  });

  it("records the scoring provenance and flags a mock-degraded period (engine mix in the durable artifact)", () => {
    expect(md).toContain("Scored by: Claude CLI ×7, Mock (deterministic) ×1");
    expect(md).toContain("some scores used the deterministic mock engine");
  });

  it("surfaces the value realized this period (the renewal-justification line)", () => {
    expect(md).toContain("Value this period: 3 recommendations completed · fleet +4 pts · 2 repos leveled up");
  });

  it("surfaces the fleet adoption rate and the FULL movement scale (not just the top-3 listed)", () => {
    expect(md).toContain("Fleet adoption: 58% of scanned repos at a high AI-adoption posture");
    // 5 up + 2 down full counts, even though only 1 gainer + 1 regression are listed below.
    expect(md).toContain("7 of 8 compared repos moved (5 ▲ / 2 ▼)");
  });

  it("NAMES the recommended next move (weakest dim) instead of offloading the decision to the LLM", () => {
    // The product makes the call on-screen — the fleet's weakest dimension (D9 Security, 41) — and the
    // trailing Ask now asks the LLM to ELABORATE that move into steps, not to GENERATE the recommendation.
    expect(md).toContain("## Recommended next move");
    expect(md).toMatch(/Raise \*\*D9 Security\*\*/);
    expect(md).toContain("## Ask");
    expect(md).toMatch(/Elaborate the recommended move above/);
    expect(md).not.toMatch(/propose the 3 highest-leverage actions/);
  });

  it("omits the period-delta suffix when there is no baseline", () => {
    const md2 = briefingMarkdown({ ...fixture, periodDelta: null });
    expect(md2).toContain("Overall maturity: **62/100** (L3 Managed)\n");
    expect(md2).not.toContain("vs last 30 days start");
  });
});

// ---------------------------------------------------------------------------
// buildExecBriefing — the single data-assembly that feeds the exec page, the
// "Copy for LLM" markdown, AND the streamed PDF. A regression to its period
// delta, prior-period, or strength/risk selection ships wrong leadership
// numbers everywhere at once. (test-mastery-2026-06-18, finding #1 critical / #2 high)
// ---------------------------------------------------------------------------

import { buildExecBriefing } from "./briefing";
import { getOrgRollup, getOrgBenchmark, getOrgMovers, listGoals, type OrgWindow } from "@/lib/db";

const mockRollup = vi.mocked(getOrgRollup);
const mockBenchmark = vi.mocked(getOrgBenchmark);
const mockMovers = vi.mocked(getOrgMovers);
const mockGoals = vi.mocked(listGoals);

// Minimal OrgRollup-shaped fixture. Only the fields buildExecBriefing reads matter; the unused
// shape (repos/trend/postureCounts/deltas) is filled with inert values so the typed mock is happy.
type Rollup = NonNullable<Awaited<ReturnType<typeof getOrgRollup>>>;
function rollup(over: Partial<Rollup> = {}): Rollup {
  return {
    org: "acme",
    repoCount: 10,
    scannedCount: 8,
    avgOverall: 70,
    avgAdoption: 66,
    avgRigor: 74,
    postureCounts: {},
    dimAverages: [
      { dimId: "D1", avg: 90 },
      { dimId: "D2", avg: 80 },
      { dimId: "D4", avg: 60 },
      { dimId: "D8", avg: 40 },
      { dimId: "D9", avg: 30 },
    ],
    repos: [],
    trend: [],
    forecast: null,
    baseline: null,
    deltas: null,
    ...over,
  } as Rollup;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy upstreams; individual tests override.
  mockRollup.mockResolvedValue(rollup());
  mockBenchmark.mockResolvedValue(null);
  mockMovers.mockResolvedValue({ gainers: [], regressers: [], levelChanges: [], comparedRepos: 0 });
  mockGoals.mockResolvedValue([]);
});

describe("buildExecBriefing — null / empty fleet", () => {
  it("returns null when the rollup is null (nothing scanned / no org)", async () => {
    mockRollup.mockResolvedValue(null);
    expect(await buildExecBriefing("acme")).toBeNull();
    // No empty/garbage briefing is fabricated — the page/PDF/LLM brief get a clean "no data".
  });

  it("returns null when the rollup exists but scannedCount is 0", async () => {
    mockRollup.mockResolvedValue(rollup({ scannedCount: 0 }));
    expect(await buildExecBriefing("acme")).toBeNull();
  });
});

describe("buildExecBriefing — coverage + maturity headline", () => {
  it("maps coverage and maturity straight off the rollup, with the real level for the score", async () => {
    const b = (await buildExecBriefing("acme"))!;
    expect(b).not.toBeNull();
    expect(b.coverage).toEqual({ scanned: 8, total: 10 });
    expect(b.maturity.overall).toBe(70);
    expect(b.maturity.adoption).toBe(66);
    expect(b.maturity.rigor).toBe(74);
    // levelForScore(70) → L4 Integrated (band 65..84) from the real model, not a hand-typed string.
    expect(b.maturity.levelId).toBe("L4");
    expect(b.maturity.levelName).toBe("Integrated");
  });

  it("threads org slug and periodTitle through to the briefing", async () => {
    const b = (await buildExecBriefing("acme", undefined, "last 30 days"))!;
    expect(b.org).toBe("acme");
    expect(b.periodTitle).toBe("last 30 days");
  });
});

describe("buildExecBriefing — periodDelta (current − baseline)", () => {
  it("is null when the rollup has no baseline", async () => {
    mockRollup.mockResolvedValue(rollup({ baseline: null }));
    const b = (await buildExecBriefing("acme"))!;
    expect(b.periodDelta).toBeNull(); // missing prior/baseline handled — no NaN
    expect(Number.isNaN(b.periodDelta as number)).toBe(false);
  });

  it("equals avgOverall − baseline.avgOverall when a baseline exists", async () => {
    mockRollup.mockResolvedValue(
      rollup({
        avgOverall: 70,
        baseline: { asOf: "2026-05-01T00:00:00.000Z", repos: 6, avgOverall: 62, avgAdoption: 60, avgRigor: 64 },
      }),
    );
    const b = (await buildExecBriefing("acme"))!;
    expect(b.periodDelta).toBe(8); // 70 - 62
  });

  it("can be negative (a real slip is reported, not floored)", async () => {
    mockRollup.mockResolvedValue(
      rollup({
        avgOverall: 55,
        baseline: { asOf: "2026-05-01T00:00:00.000Z", repos: 6, avgOverall: 62, avgAdoption: 60, avgRigor: 64 },
      }),
    );
    expect((await buildExecBriefing("acme"))!.periodDelta).toBe(-7);
  });
});

describe("buildExecBriefing — priorPeriod (vs previous equal-length window)", () => {
  it("is null for an all-time window (no window.start ⇒ no prior rollup is even fetched)", async () => {
    const b = (await buildExecBriefing("acme"))!; // no window arg
    expect(b.priorPeriod).toBeNull();
    expect(mockRollup).toHaveBeenCalledTimes(1); // only the current rollup; no prior-window read
  });

  it("derives a prior window of equal length immediately preceding the current one", async () => {
    const start = new Date("2026-06-01T00:00:00.000Z");
    const end = new Date("2026-06-15T00:00:00.000Z"); // 14-day window
    const window: OrgWindow = { start, end };
    // current rollup for the live window, then the prior-window rollup (resolved by the 2nd call).
    mockRollup.mockResolvedValueOnce(rollup()).mockResolvedValueOnce(rollup({ scannedCount: 4, avgOverall: 60 }));

    await buildExecBriefing("acme", window, "last 14 days");

    expect(mockRollup).toHaveBeenCalledTimes(2);
    const priorWindow = mockRollup.mock.calls[1][1] as OrgWindow;
    // Prior window ends exactly where the current window starts...
    expect(priorWindow.end?.getTime()).toBe(start.getTime());
    // ...and spans the same length (14 days) immediately before it.
    const len = end.getTime() - start.getTime();
    expect(priorWindow.start?.getTime()).toBe(start.getTime() - len);
  });

  it("computes headline deltas as current − prior and per-dimension now/prior/delta", async () => {
    const window: OrgWindow = { start: new Date("2026-06-01"), end: new Date("2026-06-15") };
    mockRollup
      .mockResolvedValueOnce(
        rollup({
          avgOverall: 70,
          avgAdoption: 66,
          avgRigor: 74,
          dimAverages: [
            { dimId: "D1", avg: 90 },
            { dimId: "D2", avg: 80 },
            { dimId: "D9", avg: 30 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        rollup({
          scannedCount: 6,
          avgOverall: 60,
          avgAdoption: 58,
          avgRigor: 62,
          dimAverages: [
            { dimId: "D1", avg: 70 }, // +20
            { dimId: "D2", avg: 78 }, // +2
            { dimId: "D9", avg: 35 }, // -5
          ],
        }),
      );

    const p = (await buildExecBriefing("acme", window))!.priorPeriod!;
    expect(p).not.toBeNull();
    expect(p.overall).toBe(60);
    expect(p.dOverall).toBe(10); // 70 - 60
    expect(p.dAdoption).toBe(8); // 66 - 58
    expect(p.dRigor).toBe(12); // 74 - 62

    const byId = Object.fromEntries(p.dims.map((d) => [d.dimId, d]));
    expect(byId.D1).toMatchObject({ now: 90, prior: 70, delta: 20 });
    expect(byId.D2).toMatchObject({ now: 80, prior: 78, delta: 2 });
    expect(byId.D9).toMatchObject({ now: 30, prior: 35, delta: -5 });
    // Sorted by |delta| desc: D1 (20) before D9 (5) before D2 (2).
    expect(p.dims.map((d) => d.dimId)).toEqual(["D1", "D9", "D2"]);
  });

  it("falls back to prior=0 for a dimension absent in the prior window (no NaN delta)", async () => {
    const window: OrgWindow = { start: new Date("2026-06-01"), end: new Date("2026-06-15") };
    mockRollup
      .mockResolvedValueOnce(rollup({ dimAverages: [{ dimId: "D1", avg: 50 }] }))
      .mockResolvedValueOnce(rollup({ scannedCount: 4, dimAverages: [] })); // prior has no D1

    const p = (await buildExecBriefing("acme", window))!.priorPeriod!;
    const d1 = p.dims.find((d) => d.dimId === "D1")!;
    expect(d1.prior).toBe(0);
    expect(d1.delta).toBe(50); // 50 - 0, not NaN
    expect(Number.isNaN(d1.delta)).toBe(false);
  });

  it("caps priorPeriod.dims at 6, biggest absolute mover first", async () => {
    const window: OrgWindow = { start: new Date("2026-06-01"), end: new Date("2026-06-15") };
    const ids = ["D1", "D2", "D3", "D4", "D5", "D6", "D7"];
    mockRollup
      .mockResolvedValueOnce(rollup({ dimAverages: ids.map((dimId, i) => ({ dimId, avg: 50 + i * 5 })) }))
      .mockResolvedValueOnce(rollup({ scannedCount: 6, dimAverages: ids.map((dimId) => ({ dimId, avg: 50 })) }));

    const p = (await buildExecBriefing("acme", window))!.priorPeriod!;
    expect(p.dims).toHaveLength(6); // 7 dims in, capped to 6
    const absDeltas = p.dims.map((d) => Math.abs(d.delta));
    expect([...absDeltas]).toEqual([...absDeltas].sort((a, b) => b - a)); // non-increasing
  });

  it("is null when the prior window had no scans (prior rollup empty)", async () => {
    const window: OrgWindow = { start: new Date("2026-06-01"), end: new Date("2026-06-15") };
    mockRollup.mockResolvedValueOnce(rollup()).mockResolvedValueOnce(rollup({ scannedCount: 0 }));
    expect((await buildExecBriefing("acme", window))!.priorPeriod).toBeNull();
  });
});

describe("buildExecBriefing — strengths / risks selection", () => {
  it("strengths = top dimensions desc, risks = bottom dimensions (weakest first)", async () => {
    // dimAverages (5): D1=90, D2=80, D4=60, D8=40, D9=30 — already the default fixture.
    const b = (await buildExecBriefing("acme"))!;
    expect(b.strengths.map((d) => d.dimId)).toEqual(["D1", "D2", "D4"]); // top 3 desc
    expect(b.risks.map((d) => d.dimId)).toEqual(["D9", "D8"]); // bottom of the non-strength pool, weakest first (D4 excluded — already a strength)
    // Real labels come from DIMENSION_BY_ID, not the raw id.
    expect(b.strengths[0]).toMatchObject({ dimId: "D1", label: "AI Tooling & Conventions", avg: 90 });
    expect(b.risks[0]).toMatchObject({ dimId: "D9", label: "Supply Chain & Security", avg: 30 });
  });

  it("surfaces the D9 security dimension when present", async () => {
    const b = (await buildExecBriefing("acme"))!;
    expect(b.security).toMatchObject({ dimId: "D9", label: "Supply Chain & Security", avg: 30 });
  });

  it("security is null when no D9 dimension was scored", async () => {
    mockRollup.mockResolvedValue(
      rollup({ dimAverages: [{ dimId: "D1", avg: 90 }, { dimId: "D2", avg: 80 }, { dimId: "D4", avg: 60 }] }),
    );
    expect((await buildExecBriefing("acme"))!.security).toBeNull();
  });

  // INVARIANT (finding #2 High, fixed): on a SPARSE fleet (<6 dimensions) slice(0,3) and slice(-3)
  // would overlap, listing the same dim as BOTH a top strength and a top risk. buildExecBriefing now
  // excludes any strength from the risk pool, so the two lists are DISJOINT on sparse fleets too.
  it("with 5 dimensions strengths and risks are DISJOINT (the middle dim is not in both)", async () => {
    // Default fixture has 5 dims; D4 (60) is index 2 — head-3 tail and tail-3 head used to collide on it.
    const b = (await buildExecBriefing("acme"))!;
    expect(b.strengths.map((d) => d.dimId)).toEqual(["D1", "D2", "D4"]); // top 3 desc
    expect(b.risks.map((d) => d.dimId)).toEqual(["D9", "D8"]); // bottom of the non-strength pool, weakest first
    const sIds = new Set(b.strengths.map((d) => d.dimId));
    const rIds = new Set(b.risks.map((d) => d.dimId));
    const overlap = [...sIds].filter((id) => rIds.has(id));
    expect(overlap).toEqual([]); // D4 is no longer both a top strength and a top risk
  });

  // executive-briefing #4: with only 3 dims the OLD slice(0,3) claimed ALL of them as strengths — so
  // D9@30 was listed as a "strength" while ALSO being the fleet's weakness (risks was then empty, which
  // let the page's security special-case re-surface D9 → the same dim in both). Strengths are now capped
  // to the top half (ceil(3/2)=2), so the weakest dim falls into risks instead of being mislabeled.
  it("with exactly 3 dimensions the weakest is a risk, not a mislabeled strength (and the lists are disjoint)", async () => {
    mockRollup.mockResolvedValue(
      rollup({ dimAverages: [{ dimId: "D1", avg: 90 }, { dimId: "D2", avg: 60 }, { dimId: "D9", avg: 30 }] }),
    );
    const b = (await buildExecBriefing("acme"))!;
    expect(b.strengths.map((d) => d.dimId)).toEqual(["D1", "D2"]); // top half — D9@30 is NOT a strength
    expect(b.risks.map((d) => d.dimId)).toEqual(["D9"]); // the obviously-weak dim is the risk
    const sIds = new Set(b.strengths.map((d) => d.dimId));
    const rIds = new Set(b.risks.map((d) => d.dimId));
    expect([...sIds].filter((id) => rIds.has(id))).toEqual([]); // disjoint: no dim in both
  });

  it("on a fleet with ≥7 dimensions strengths and risks ARE disjoint", async () => {
    mockRollup.mockResolvedValue(
      rollup({
        dimAverages: [
          { dimId: "D1", avg: 95 },
          { dimId: "D2", avg: 85 },
          { dimId: "D3", avg: 75 },
          { dimId: "D4", avg: 60 },
          { dimId: "D5", avg: 45 },
          { dimId: "D8", avg: 35 },
          { dimId: "D9", avg: 25 },
        ],
      }),
    );
    const b = (await buildExecBriefing("acme"))!;
    const sIds = new Set(b.strengths.map((d) => d.dimId));
    const rIds = new Set(b.risks.map((d) => d.dimId));
    expect([...sIds].filter((id) => rIds.has(id))).toEqual([]); // disjoint when N ≥ 6
  });
});

describe("buildExecBriefing — benchmark / movers / goals pass-through", () => {
  it("maps benchmark + same-language cohort when present, null otherwise", async () => {
    mockBenchmark.mockResolvedValue({
      corpusRepos: 240,
      overallPercentile: 71,
      corpusAvgOverall: 54,
      corpusAvgAdoption: 50,
      corpusAvgRigor: 58,
      cohort: { language: "TypeScript", repos: 60, overallPercentile: 68, adoptionPercentile: 55, avgOverall: 57 },
    });
    const b = (await buildExecBriefing("acme"))!;
    expect(b.benchmark).toMatchObject({ percentile: 71, corpusRepos: 240, corpusAvgOverall: 54 });
    expect(b.benchmark!.cohort).toMatchObject({ language: "TypeScript", repos: 60, overallPercentile: 68, adoptionPercentile: 55 });
  });

  it("benchmark is null when the upstream returns null", async () => {
    mockBenchmark.mockResolvedValue(null);
    expect((await buildExecBriefing("acme"))!.benchmark).toBeNull();
  });

  it("caps top gainers/regressions at 3 and counts ALL regressions", async () => {
    const move = (name: string, dOverall: number) => ({
      fullName: `acme/${name}`,
      name,
      overall: 60,
      dOverall,
      dAdoption: 0,
      dRigor: 0,
      levelFrom: "L2",
      levelTo: "L3",
      levelDelta: 0,
      postureFrom: "stable",
      postureTo: "stable",
      sinceDays: 7,
    });
    mockMovers.mockResolvedValue({
      gainers: [move("a", 9), move("b", 8), move("c", 7), move("d", 6)],
      regressers: [move("x", -5), move("y", -4), move("z", -3), move("w", -2)],
      levelChanges: [],
      comparedRepos: 8,
    });
    const b = (await buildExecBriefing("acme"))!;
    expect(b.topGainers).toHaveLength(3);
    expect(b.topRegressions).toHaveLength(3);
    expect(b.topGainers.map((m) => m.name)).toEqual(["a", "b", "c"]);
    expect(b.regressionCount).toBe(4); // ALL regressers counted, not just the displayed 3
  });

  it("tolerates null movers (no gainers/regressions, regressionCount 0)", async () => {
    mockMovers.mockResolvedValue(null);
    const b = (await buildExecBriefing("acme"))!;
    expect(b.topGainers).toEqual([]);
    expect(b.topRegressions).toEqual([]);
    expect(b.regressionCount).toBe(0);
  });

  it("maps goal progress rows through, and tolerates null goals", async () => {
    mockGoals.mockResolvedValue([
      { label: "Lift security", metric: "D9", current: 41, target: 70, pct: 22, pace: "behind", etaDays: 120 } as never,
    ]);
    let b = (await buildExecBriefing("acme"))!;
    expect(b.goals).toEqual([{ label: "Lift security", current: 41, target: 70, pct: 22, pace: "behind", etaDays: 120 }]);

    mockGoals.mockResolvedValue(null);
    b = (await buildExecBriefing("acme"))!;
    expect(b.goals).toEqual([]);
  });
});

describe("buildExecBriefing — end-to-end into briefingMarkdown (no garbage on a real assembly)", () => {
  it("a sparse assembled briefing serializes without null/undefined/NaN and keeps the trailing Ask", async () => {
    // Minimal upstreams: no benchmark, no movers, no goals, no prior window.
    const md = briefingMarkdown((await buildExecBriefing("acme"))!);
    expect(md).not.toMatch(/null|undefined|NaN/);
    expect(md).toContain("## Ask");
    expect(md).toContain("Overall maturity: **70/100** (L4 Integrated)");
  });
});

// ---------------------------------------------------------------------------
// briefingMarkdown — null / empty BRANCHES (test-mastery-2026-06-18, MEDIUM:
// "only the all-populated path is tested"). The serializer feeds the exec page,
// the "Copy for LLM" payload AND the PDF; every optional field is a conditional
// branch. Pin the empty-state output of each so a missing benchmark/forecast/
// prior-period/mover/goal/security never leaks "undefined"/"null"/"NaN" — and a
// PARTIALLY-populated briefing renders only the sections that are present.
// ---------------------------------------------------------------------------

// A fully-empty briefing: no delta, no benchmark, no forecast, no prior period,
// no strengths/risks, no security, no movers, no goals. Every conditional OFF.
const emptyBriefing: ExecBriefing = {
  org: "acme",
  periodTitle: "all time",
  generatedOn: "2026-06-09",
  maturity: { overall: 0, levelId: "L1", levelName: "Ad-hoc", adoption: 0, rigor: 0 },
  coverage: { scanned: 0, total: 0 },
  periodDelta: null,
  priorPeriod: null,
  forecastHeadline: null,
  forecastConfidence: null,
  engineMix: [],
  valueRealized: { recsEngaged: 0, recsActioned: 0, pointsMoved: null, reposPromoted: 0 },
  adoptionRate: null,
  movement: { up: 0, down: 0, compared: 0 },
  benchmark: null,
  strengths: [],
  risks: [],
  security: null,
  topGainers: [],
  topRegressions: [],
  goals: [],
  regressionCount: 0,
};

describe("briefingMarkdown — null / empty branches", () => {
  const md = briefingMarkdown(emptyBriefing);

  it("never leaks undefined / null / NaN and does not crash on a fully-empty briefing", () => {
    expect(() => briefingMarkdown(emptyBriefing)).not.toThrow();
    expect(md).not.toMatch(/undefined|null|NaN/);
  });

  it("still renders the fixed scaffold (standing + headers + trailing Ask)", () => {
    // The non-conditional skeleton is always present even with zero data.
    expect(md).toContain("# Ascent — AI-native engineering maturity briefing: acme");
    expect(md).toContain("## Standing");
    expect(md).toContain("Overall maturity: **0/100** (L1 Ad-hoc)");
    expect(md).toContain("- AI Adoption: 0/100 · Engineering Rigor: 0/100");
    expect(md).toContain("Coverage: 0/0 repositories scanned");
    expect(md).toContain("## Strengths (top dimensions)");
    expect(md).toContain("## Weakest dimensions (where to focus)");
    expect(md).toContain("## Ask");
  });

  it("omits the standing-line extras when benchmark / cohort / forecast are absent", () => {
    expect(md).not.toMatch(/percentile/);
    expect(md).not.toMatch(/Peer cohort/);
    expect(md).not.toMatch(/Trajectory:/);
  });

  it("omits the whole 'vs previous period' section when priorPeriod is null", () => {
    expect(md).not.toContain("## vs previous period");
  });

  it("omits the Movement section when there are no gainers and no regressions", () => {
    expect(md).not.toContain("## Movement this period");
    expect(md).not.toMatch(/[▲▼]/);
  });

  it("omits the Goals section when there are no goals", () => {
    expect(md).not.toContain("## Goals");
  });

  it("omits the security line when security is null", () => {
    // The Weakest-dimensions header is present, but no Security: row underneath.
    expect(md).toContain("## Weakest dimensions (where to focus)");
    expect(md).not.toMatch(/Security \(/);
  });

  it("leaves the Strengths / Weakest sections header-only (no bullet rows) when both lists are empty", () => {
    const lines = md.split("\n");
    const after = (header: string) => {
      const i = lines.indexOf(header);
      return i >= 0 ? lines[i + 1] : undefined;
    };
    // The line directly after each header is NOT a "- " bullet (it's the blank
    // separator or the next header) — i.e. the empty list produced no rows.
    expect(after("## Strengths (top dimensions)")?.startsWith("- ")).toBe(false);
    expect(after("## Weakest dimensions (where to focus)")?.startsWith("- ")).toBe(false);
  });
});

describe("briefingMarkdown — partially-populated briefing renders only present sections", () => {
  it("renders ONLY a benchmark with no cohort (corpus line shown, cohort line skipped)", () => {
    const md = briefingMarkdown({
      ...emptyBriefing,
      benchmark: { percentile: 60, corpusRepos: 100, corpusAvgOverall: 50, cohort: null },
    });
    expect(md).toContain("60th percentile vs 100 repos (corpus avg 50)");
    expect(md).not.toMatch(/Peer cohort/);
    expect(md).not.toMatch(/undefined|null|NaN/);
  });

  it("renders a benchmark whose percentile is null without the percentile line", () => {
    const md = briefingMarkdown({
      ...emptyBriefing,
      benchmark: { percentile: null, corpusRepos: 100, corpusAvgOverall: 50, cohort: null },
    });
    expect(md).not.toMatch(/percentile vs/);
    expect(md).not.toMatch(/undefined|null|NaN/);
  });

  it("renders a cohort line but omits the adoption clause when cohort.adoptionPercentile is null", () => {
    const md = briefingMarkdown({
      ...emptyBriefing,
      benchmark: {
        percentile: 60,
        corpusRepos: 100,
        corpusAvgOverall: 50,
        cohort: { language: "Go", repos: 30, overallPercentile: 64, adoptionPercentile: null },
      },
    });
    expect(md).toContain("Peer cohort (Go): 64th percentile overall vs 30 Go repos");
    expect(md).not.toMatch(/on AI adoption/);
    expect(md).not.toMatch(/undefined|null|NaN/);
  });

  it("renders a prior period but drops zero-delta dimension rows", () => {
    const md = briefingMarkdown({
      ...emptyBriefing,
      priorPeriod: {
        overall: 50,
        adoption: 48,
        rigor: 52,
        dOverall: 5,
        dAdoption: 3,
        dRigor: 7,
        dims: [
          { dimId: "D1", label: "Tooling", now: 60, prior: 50, delta: 10 },
          { dimId: "D2", label: "Testing", now: 40, prior: 40, delta: 0 }, // unchanged → dropped
        ],
      },
    });
    expect(md).toContain("## vs previous period");
    expect(md).toContain("D1 Tooling: 50 → 60 (+10)");
    expect(md).not.toMatch(/D2 Testing/); // zero-delta row filtered out
    expect(md).not.toMatch(/undefined|null|NaN/);
  });

  it("renders a goal without an ETA clause when etaDays is null", () => {
    const md = briefingMarkdown({
      ...emptyBriefing,
      goals: [{ label: "Raise rigor", current: 30, target: 60, pct: 50, pace: "on track", etaDays: null }],
    });
    expect(md).toContain("## Goals");
    expect(md).toContain("Raise rigor: 30/60 (50%, on track)");
    expect(md).not.toMatch(/ETA/);
    expect(md).not.toMatch(/undefined|null|NaN/);
  });

  it("renders only gainers (Movement section appears) when regressions are empty", () => {
    const md = briefingMarkdown({
      ...emptyBriefing,
      topGainers: [{ name: "api", dOverall: 7, levelFrom: "L2", levelTo: "L2" }],
    });
    expect(md).toContain("## Movement this period");
    expect(md).toMatch(/▲ api: \+7(?!\s*\()/); // same level → no (Lx→Ly) suffix
    expect(md).not.toMatch(/▼/); // no regression rows
    expect(md).not.toMatch(/undefined|null|NaN/);
  });

  it("shows the security line when only security is populated", () => {
    const md = briefingMarkdown({
      ...emptyBriefing,
      security: { dimId: "D9", label: "Security", avg: 35 },
    });
    expect(md).toContain("Security (D9 Security): 35/100");
    expect(md).not.toMatch(/undefined|null|NaN/);
  });
});

// ---------------------------------------------------------------------------
// buildExecBriefing — DETERMINISTIC generatedOn (test-mastery-2026-06-18, LOW:
// "make buildExecBriefing's generated dates deterministic and pin them"). The
// briefing stamps `generatedOn: new Date().toISOString().slice(0, 10)` at line
// 156 — wall-clock, so an un-pinned assertion would flake at a UTC date boundary
// and the stamp itself was never asserted from a real assembly. Control the
// CLOCK (no source change): with vi.useFakeTimers() + setSystemTime, the stamp
// is exactly the fixed day, the documented YYYY-MM-DD form, and the derived
// prior-period window is computed off that same frozen now — all reproducible.
// ---------------------------------------------------------------------------
describe("buildExecBriefing — deterministic generatedOn (frozen clock)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps generatedOn to the frozen system date in documented YYYY-MM-DD form", async () => {
    // Pin the clock to a precise instant. toISOString() is UTC, so we freeze on a
    // UTC instant and assert the UTC calendar day — exactly what the source slices.
    vi.setSystemTime(new Date("2026-06-18T12:34:56.000Z"));
    const b = (await buildExecBriefing("acme"))!;
    expect(b.generatedOn).toBe("2026-06-18"); // exact, deterministic — no flake
    expect(b.generatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/); // documented YYYY-MM-DD form
  });

  it("is reproducible: two assemblies under the SAME frozen clock stamp the SAME date", async () => {
    vi.setSystemTime(new Date("2026-01-09T00:00:00.000Z"));
    const a = (await buildExecBriefing("acme"))!;
    const b = (await buildExecBriefing("acme"))!;
    expect(a.generatedOn).toBe("2026-01-09");
    expect(b.generatedOn).toBe(a.generatedOn); // identical stamp, no wall-clock drift
  });

  it("re-stamps to a DIFFERENT frozen date when the clock is moved (the stamp tracks now)", async () => {
    vi.setSystemTime(new Date("2025-12-31T23:59:59.000Z"));
    expect((await buildExecBriefing("acme"))!.generatedOn).toBe("2025-12-31");
    // Advance one second across the year boundary — the UTC calendar day rolls over.
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    expect((await buildExecBriefing("acme"))!.generatedOn).toBe("2026-01-01");
  });

  it("derives the prior-period window off the SAME frozen now (open-ended window end = frozen now)", async () => {
    // An open-ended window (start but no end) makes the source fall back to `new Date()`
    // for the window end when computing the prior window length. Freezing the clock makes
    // that fallback — and the prior window it produces — fully deterministic.
    vi.setSystemTime(new Date("2026-06-18T00:00:00.000Z"));
    const start = new Date("2026-06-11T00:00:00.000Z"); // 7 days before frozen now
    const window: OrgWindow = { start }; // no end ⇒ end defaults to frozen now
    mockRollup.mockResolvedValueOnce(rollup()).mockResolvedValueOnce(rollup({ scannedCount: 4, avgOverall: 60 }));

    const b = (await buildExecBriefing("acme", window))!;
    expect(b.generatedOn).toBe("2026-06-18"); // stamp uses the same frozen now

    // Prior window ends where the current window starts, and spans (frozen now − start) before it.
    expect(mockRollup).toHaveBeenCalledTimes(2);
    const priorWindow = mockRollup.mock.calls[1][1] as OrgWindow;
    const len = new Date("2026-06-18T00:00:00.000Z").getTime() - start.getTime(); // 7 days, off frozen now
    expect(priorWindow.end?.getTime()).toBe(start.getTime());
    expect(priorWindow.start?.getTime()).toBe(start.getTime() - len);
  });
});
