// The "Copy for LLM" payload is a product contract — a dev pastes it into Claude Code. Lock its
// shape: standing headline, benchmark, strengths/weaknesses, movement, and a trailing actionable ASK.

import { describe, it, expect } from "vitest";
import { briefingMarkdown, type ExecBriefing } from "./briefing";

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

describe("briefingMarkdown", () => {
  const md = briefingMarkdown(fixture);

  it("leads with the standing headline incl. level and period delta", () => {
    expect(md).toContain("Overall maturity: **62/100** (L3 Managed) (+4 vs last 30 days start)");
    expect(md).toContain("Coverage: 8/12 repositories scanned");
  });

  it("includes benchmark, strengths, weakest dims, trajectory and movement", () => {
    expect(md).toContain("71th percentile vs 240 repos");
    expect(md).toContain("Peer cohort (TypeScript): 68th percentile overall vs 60 TypeScript repos; 55th on AI adoption");
    expect(md).toContain("Trajectory: On track to reach L4 in 6 weeks.");
    expect(md).toContain("D2 Testing: 80/100");
    expect(md).toContain("D9 Security: 41/100");
    expect(md).toMatch(/▲ api: \+9 \(L2→L3\)/);
    expect(md).toMatch(/▼ legacy: -5(?!\s*\()/); // no level transition shown when from === to
  });

  it("renders goals with progress + ETA", () => {
    expect(md).toContain("Lift security: 41/70 (22%, behind, ETA ~120d)");
  });

  it("ends with an actionable ASK so it's paste-ready for an LLM", () => {
    expect(md).toContain("## Ask");
    expect(md).toMatch(/3 highest-leverage actions/);
  });

  it("omits the period-delta suffix when there is no baseline", () => {
    const md2 = briefingMarkdown({ ...fixture, periodDelta: null });
    expect(md2).toContain("Overall maturity: **62/100** (L3 Managed)\n");
    expect(md2).not.toContain("vs last 30 days start");
  });
});
