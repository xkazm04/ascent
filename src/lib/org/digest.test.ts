// The weekly digest assembler. Every read it composes is mocked, because none of them are what this
// module can get wrong: the failure modes that live HERE are (a) a degraded read disappearing without
// a trace, (b) "unmeasurable" rendering as zero, and (c) a delta inside the noise band wearing the
// same arrow as a real move. Those three are what the suite pins.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgMovers, OrgRec } from "@/lib/db/org-insights";
import type { OrgRollup } from "@/lib/db/org-rollup";

const {
  mockGetOrgRollup,
  mockGetOrgEngineMix,
  mockGetOrgMovers,
  mockGetOrgRecommendations,
  mockClosed,
  mockOpened,
  mockScanCount,
} = vi.hoisted(() => ({
  mockGetOrgRollup: vi.fn(),
  mockGetOrgEngineMix: vi.fn(),
  mockGetOrgMovers: vi.fn(),
  mockGetOrgRecommendations: vi.fn(),
  mockClosed: vi.fn(),
  mockOpened: vi.fn(),
  mockScanCount: vi.fn(),
}));

// `isDbConfigured: false` keeps the REAL modules (loaded through importOriginal below, so every named
// export the `@/lib/db` barrel re-exports still exists) from ever reaching for a client.
vi.mock("@/lib/db/client", () => ({ getPrisma: vi.fn(), isDbConfigured: vi.fn(() => false) }));

vi.mock("@/lib/db/org-rollup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/org-rollup")>()),
  getOrgRollup: mockGetOrgRollup,
  getOrgEngineMix: mockGetOrgEngineMix,
}));
vi.mock("@/lib/db/org-insights", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/org-insights")>()),
  getOrgMovers: mockGetOrgMovers,
  getOrgRecommendations: mockGetOrgRecommendations,
}));
vi.mock("@/lib/db/org-followups-week", () => ({
  getFollowupsClosedInWindow: mockClosed,
  getFollowupsOpenedInWindow: mockOpened,
  countScansInWindow: mockScanCount,
}));

import { buildWeeklyDigest } from "@/lib/org/digest";

const NOW = new Date("2026-09-01T12:00:00.000Z");

const rollup = (over: Partial<OrgRollup> = {}): OrgRollup =>
  ({
    org: "acme",
    repoCount: 12,
    scannedCount: 9,
    avgOverall: 61,
    avgAdoption: 58,
    avgRigor: 64,
    postureCounts: {},
    // Deliberately out of order — the digest sorts by dimId so two renders of the same week cannot
    // present the rows in whatever order the aggregate happened to build them.
    dimAverages: [
      { dimId: "D9", avg: 70 },
      { dimId: "D1", avg: 52 },
      { dimId: "D3", avg: 44 },
    ],
    repos: [],
    trend: [],
    forecast: null,
    baseline: null,
    deltas: null,
    movement: { overall: 4, adoption: 3, rigor: 5, cohortSize: 8, onboarded: 1, departed: 0 },
    dimDeltas: [
      { dimId: "D1", delta: 6 },
      { dimId: "D9", delta: 1 },
    ],
    ...over,
  }) as OrgRollup;

const rec = (over: Partial<OrgRec> = {}): OrgRec =>
  ({
    title: "Adopt dependency review",
    dimId: "D9",
    impact: "high",
    rationale: "",
    explore: [],
    repoCount: 5,
    repos: [],
    leverage: 1,
    projectedPoints: 7,
    liftsRepos: 2,
    ...over,
  }) as OrgRec;

const movers = (over: Partial<OrgMovers> = {}): OrgMovers =>
  ({
    gainers: [
      { name: "api", fullName: "acme/api", dOverall: 9, levelFrom: "L2", levelTo: "L3" },
      { name: "web", fullName: "acme/web", dOverall: 6, levelFrom: "L2", levelTo: "L2" },
      { name: "cli", fullName: "acme/cli", dOverall: 5, levelFrom: "L1", levelTo: "L2" },
      { name: "docs", fullName: "acme/docs", dOverall: 4, levelFrom: "L1", levelTo: "L1" },
    ],
    regressers: [{ name: "legacy", fullName: "acme/legacy", dOverall: -7, levelFrom: "L3", levelTo: "L2" }],
    held: [],
    levelChanges: [],
    onboarded: [],
    comparedRepos: 8,
    ...over,
  }) as OrgMovers;

const closedFixture = {
  closed: 2,
  dismissed: 1,
  rows: [
    { title: "No dependency review", dimId: "D9", dimLabel: "Security", repo: "acme/api", at: "2026-08-29T10:00:00.000Z", how: "human" as const },
    { title: "No CI on main", dimId: "D5", dimLabel: "CI", repo: "acme/web", at: "2026-08-28T10:00:00.000Z", how: "scan" as const },
  ],
};

const openedFixture = {
  opened: 3,
  rows: [{ title: "Missing AI manifest", dimId: "D1", dimLabel: "Manifest", repo: "acme/cli", at: null, how: null }],
  unmeasuredRepos: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgRollup.mockResolvedValue(rollup());
  mockGetOrgEngineMix.mockResolvedValue([{ provider: "claude-cli", count: 12 }]);
  mockGetOrgMovers.mockResolvedValue(movers());
  mockGetOrgRecommendations.mockResolvedValue([
    rec(),
    rec({ title: "Write a contributing guide", dimId: "D3", impact: "medium", repoCount: 1, projectedPoints: 3 }),
    rec({ title: "Pin the toolchain", dimId: "D4", impact: "low", repoCount: 4, projectedPoints: null }),
  ]);
  mockClosed.mockResolvedValue(closedFixture);
  mockOpened.mockResolvedValue(openedFixture);
  mockScanCount.mockResolvedValue(14);
});

describe("buildWeeklyDigest — happy path", () => {
  it("fixes the window to the trailing 7 calendar days and hands the SAME half-open bounds to every read", async () => {
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.window.from).toBe("2026-08-26");
    expect(d.window.to).toBe("2026-09-01");
    expect(d.window.start).toBe("2026-08-26T00:00:00.000Z");
    expect(d.window.endExclusive).toBe("2026-09-02T00:00:00.000Z");
    expect(d.window.title).toBe("2026-08-26 → 2026-09-01");
    expect(d.generatedOn).toBe("2026-09-01");

    const bounds = { start: new Date("2026-08-26T00:00:00.000Z"), endExclusive: new Date("2026-09-02T00:00:00.000Z") };
    for (const m of [mockGetOrgRollup, mockGetOrgMovers, mockGetOrgEngineMix, mockClosed, mockOpened, mockScanCount]) {
      expect(m).toHaveBeenCalledWith("acme", bounds);
    }
  });

  it("carries the cohort denominator beside every headline delta", async () => {
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.headline).toMatchObject({
      overall: 61,
      levelId: "L3",
      dOverall: 4,
      dAdoption: 3,
      dRigor: 5,
      cohortSize: 8,
      onboarded: 1,
      departed: 0,
      scanned: 9,
      total: 12,
    });
    expect(typeof d.headline.levelName).toBe("string");
  });

  it("sorts dimensions by id and classifies each delta into a band", async () => {
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.dims.map((x) => [x.dimId, x.delta, x.band])).toEqual([
      // A real climb.
      ["D1", 6, "up"],
      // No entry in dimDeltas → not measurable. NOT zero: "unmeasured" and "flat" are different facts.
      ["D3", null, "unmeasured"],
      // +1 is inside the canonical noise band (SCORE_NOISE_BAND = 2) — it must not wear an arrow.
      ["D9", 1, "flat"],
    ]);
    expect(d.dims[0]!.label).not.toBe("D1"); // resolved from the rubric
    expect(d.dims[0]!.now).toBe(52);
  });

  it("ranks three actions, with the shared next-move sentence at rank 1", async () => {
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.actions.map((a) => a.rank)).toEqual([1, 2, 3]);
    // Rank 1 is `nextMoveLine` — the same sentence the executive briefing and the board PDF print,
    // which names the scanned denominator behind "shared by N repositories".
    expect(d.actions[0]!.line).toContain("the widest shared gap across the fleet");
    expect(d.actions[0]!.line).toContain("of the 9 scanned repositories");
    // Ranks 2/3 take the short form; the singular/plural and the optional gain are both honoured.
    expect(d.actions[1]!.line).toBe("Write a contributing guide (D3 CI/CD & Delivery, medium impact, 1 repository, ≈ +3 pts each)");
    // No projected points on this one — the "≈ +N pts each" clause is omitted rather than zeroed.
    expect(d.actions[2]!.line).toBe("Pin the toolchain (D4 Agentic Workflows, low impact, 4 repositories)");
  });

  it("takes the top three movers each way and carries the compared count", async () => {
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.movement!.gainers.map((m) => m.name)).toEqual(["api", "web", "cli"]);
    expect(d.movement!.regressers.map((m) => m.name)).toEqual(["legacy"]);
    expect(d.movement!.compared).toBe(8);
  });

  it("composes the two follow-up reads without merging them", async () => {
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.followups).toEqual({
      closed: 2,
      dismissed: 1,
      closedRows: closedFixture.rows,
      opened: 3,
      openedRows: openedFixture.rows,
      openedMeasurable: true,
      unmeasuredRepos: 1,
    });
  });

  it("records provenance and stays silent when nothing degraded", async () => {
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.provenance.scansInWindow).toBe(14);
    expect(d.provenance.engineCaveat).toBeNull(); // no mock scores in the mix
    expect(d.provenance.notes).toEqual([]);
  });

  it("raises the mock-engine caveat when the week's scores came from the deterministic engine", async () => {
    mockGetOrgEngineMix.mockResolvedValue([{ provider: "mock", count: 4 }]);
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.provenance.engineCaveat).toContain("mock engine");
  });
});

describe("buildWeeklyDigest — degradation", () => {
  it("returns null when the rollup is unavailable", async () => {
    mockGetOrgRollup.mockResolvedValue(null);
    expect(await buildWeeklyDigest("acme", NOW)).toBeNull();
  });

  it("returns null when nothing has been graded — there is no standing to report", async () => {
    // An ungraded rollup carries null averages, not zeroes; the guard reads the averages themselves,
    // so a scanned-but-all-mock fleet is refused for the same reason an unscanned one is.
    mockGetOrgRollup.mockResolvedValue(rollup({ scannedCount: 0, avgOverall: null, avgAdoption: null, avgRigor: null }));
    expect(await buildWeeklyDigest("acme", NOW)).toBeNull();
    mockGetOrgRollup.mockResolvedValue(rollup({ scannedCount: 9, avgOverall: null, avgAdoption: null, avgRigor: null }));
    expect(await buildWeeklyDigest("acme", NOW)).toBeNull();
  });

  it("survives a failing movers read, and SAYS SO — the section never vanishes silently", async () => {
    mockGetOrgMovers.mockRejectedValue(new Error("timeout"));
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.movement).toBeNull();
    expect(d.provenance.notes).toEqual(["Repository movement could not be read."]);
    // Everything else still renders.
    expect(d.headline.overall).toBe(61);
    expect(d.actions).toHaveLength(3);
  });

  it("notes each independent failure exactly once", async () => {
    mockGetOrgRecommendations.mockRejectedValue(new Error("boom"));
    mockScanCount.mockRejectedValue(new Error("boom"));
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.actions).toEqual([]);
    expect(d.provenance.scansInWindow).toBeNull();
    expect(d.provenance.notes).toHaveLength(2);
  });

  it("reports an unmeasurable opened-diff as unmeasurable, never as zero", async () => {
    mockOpened.mockResolvedValue(null);
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.followups).toMatchObject({
      opened: 0,
      openedRows: [],
      openedMeasurable: false,
      // Nothing could be compared, so EVERY scanned repository is one the diff could not speak for.
      unmeasuredRepos: 9,
    });
    // Not a failure — the digest prints "not measurable", so there is nothing to apologise for.
    expect(d.provenance.notes).toEqual([]);
    // The closed half is unaffected.
    expect(d.followups!.closed).toBe(2);
  });

  it("drops the whole follow-up block, with a note, when the closed read fails", async () => {
    mockClosed.mockRejectedValue(new Error("boom"));
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.followups).toBeNull();
    expect(d.provenance.notes).toEqual(["Follow-up activity could not be read."]);
  });

  it("nulls every headline delta together when there is no cohort movement", async () => {
    mockGetOrgRollup.mockResolvedValue(rollup({ movement: null, dimDeltas: null }));
    const d = (await buildWeeklyDigest("acme", NOW))!;
    expect(d.headline).toMatchObject({ dOverall: null, dAdoption: null, dRigor: null, cohortSize: null, onboarded: 0, departed: 0 });
    expect(d.dims.every((x) => x.band === "unmeasured" && x.delta === null)).toBe(true);
  });
});
