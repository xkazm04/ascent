// Shared briefing fixtures for the Prism composition tests. Not a render path.
import type { ImpactLedger, ImpactRow } from "@/lib/db/org-impact";
import type { OrgRec } from "@/lib/db";
import type { BriefingGoal, ExecBriefing } from "@/lib/org/briefing";
import type { ResolvedWindow } from "@/lib/window";
import type { ExecutiveView } from "./executiveView";

export const execPeriod: ResolvedWindow = {
  key: "90d",
  start: null,
  end: null,
  endExclusive: null,
  title: "Last 90 days",
  comparisonLabel: "vs last 90 days",
  reviewTitle: "Last 90 days",
};

export function execBriefing(overrides: Partial<ExecBriefing> = {}): ExecBriefing {
  return {
    org: "acme",
    periodTitle: "Last 90 days",
    generatedOn: "2026-09-01",
    maturity: { overall: 0, levelId: "L1", levelName: "Manual", adoption: 0, rigor: 0 },
    coverage: { scanned: 2, total: 2 },
    realScoredCount: 0,
    mockCount: 2,
    periodDelta: null,
    priorPeriod: null,
    forecastHeadline: null,
    forecastConfidence: null,
    engineMix: [],
    adoptionRate: null,
    movement: { up: 0, down: 0, compared: 0 },
    valueRealized: { recsEngaged: 0, recsActioned: 0, pointsMoved: null, reposPromoted: 0 },
    benchmark: { percentile: null, corpusRepos: 0, corpusAvgOverall: 0, cohort: null },
    strengths: [],
    risks: [],
    security: null,
    topGainers: [],
    topRegressions: [],
    goals: [],
    regressionCount: 0,
    ...overrides,
  };
}

export function execView(overrides: Partial<ExecutiveView> = {}): ExecutiveView {
  return {
    slug: "acme",
    period: execPeriod,
    segmentId: null,
    techGroups: [],
    activeStack: null,
    briefing: execBriefing(),
    md: "md",
    impact: null,
    program: null,
    canShare: false,
    branding: null,
    canBrand: false,
    ...overrides,
  };
}

export function impactRow(overrides: Partial<ImpactRow> = {}): ImpactRow {
  return {
    repoFullName: "acme/api",
    repoName: "api",
    dimId: "D1",
    practiceId: "tests",
    practiceLabel: "Tests",
    prNumber: 4,
    prUrl: "https://github.com/acme/api/pull/4",
    mergedAt: "2026-09-01T12:00:00.000Z",
    impactDim: 5,
    impactOverall: 2,
    verified: false,
    source: "practice-pr",
    basis: "merged",
    laneId: null,
    ...overrides,
  };
}

export function impactLedger(overrides: Partial<ImpactLedger> = {}): ImpactLedger {
  return {
    mergedCount: 1,
    verifiedCount: 0,
    awaitingRescan: 1,
    unmeasurable: 0,
    reposMoved: 0,
    dimPoints: null,
    regressions: 0,
    byDim: [],
    rows: [impactRow()],
    inReviewPoints: null,
    inReviewLanes: 0,
    ...overrides,
  };
}

export function orgRec(overrides: Partial<OrgRec> = {}): OrgRec {
  return {
    title: "AI Tooling and Conventions",
    dimId: "D1",
    impact: "high",
    rationale: "Shared conventions are missing.",
    explore: ["Where would an agent look first?"],
    repoCount: 2,
    repos: ["api", "web"],
    leverage: 3,
    projectedPoints: null,
    liftsRepos: 0,
    ...overrides,
  };
}

export function briefingGoal(overrides: Partial<BriefingGoal> = {}): BriefingGoal {
  return {
    label: "Coverage",
    current: null,
    target: 60,
    pct: null,
    pctBasis: "unmeasured",
    pctLabel: "",
    pace: "flat",
    etaDays: null,
    ...overrides,
  };
}
