import { describe, expect, it } from "vitest";
import { explainTeamStandings } from "@/lib/org/teamStandings";
import type { TeamRollup } from "@/lib/db/org-teams";

// Pure decomposition of the team standings: rank by avgOverall, then attribute each extreme's
// distance from the fleet mean to the dimensions driving it. No DB — mirrors teamRollup.test's
// "test the pure transform" approach.

function team(slug: string, over: Partial<TeamRollup> & { dims?: { dimId: string; label: string; avg: number }[] }): TeamRollup {
  const { dims, ...rest } = over;
  return {
    slug,
    name: slug.split("/")[1] ?? slug,
    repoCount: 1,
    totalOwned: 1,
    defaultOwnerCount: 0,
    repos: [],
    avgOverall: 50,
    avgAdoption: 50,
    avgRigor: 50,
    posture: "manual",
    dimAverages: dims ?? [],
    strongest: null,
    weakest: null,
    contributors: 0,
    aiContributors: 0,
    aiCommitShare: 0,
    champions: [],
    knowledgeScore: 0,
    comparedRepos: 0,
    improving: 0,
    declining: 0,
    avgDelta: 0,
    ...rest,
  };
}

const FLEET: TeamRollup[] = [
  team("@acme/frontend", {
    avgOverall: 80,
    aiCommitShare: 60,
    avgDelta: 8,
    comparedRepos: 2,
    improving: 2,
    dims: [
      { dimId: "D1", label: "AI Tooling", avg: 90 },
      { dimId: "D2", label: "Testing", avg: 70 },
      { dimId: "D4", label: "Agentic", avg: 80 },
    ],
  }),
  team("@acme/platform", {
    avgOverall: 58,
    aiCommitShare: 30,
    dims: [
      { dimId: "D1", label: "AI Tooling", avg: 60 },
      { dimId: "D2", label: "Testing", avg: 60 },
      { dimId: "D4", label: "Agentic", avg: 50 },
    ],
  }),
  team("@acme/data", {
    avgOverall: 36,
    aiCommitShare: 10,
    avgDelta: -4,
    comparedRepos: 1,
    declining: 1,
    dims: [
      { dimId: "D1", label: "AI Tooling", avg: 30 },
      { dimId: "D2", label: "Testing", avg: 50 },
      { dimId: "D4", label: "Agentic", avg: 20 },
    ],
  }),
];

describe("explainTeamStandings", () => {
  const out = explainTeamStandings(FLEET)!;

  it("returns null when there aren't two teams to contrast", () => {
    expect(explainTeamStandings([])).toBeNull();
    expect(explainTeamStandings([FLEET[0]!])).toBeNull();
  });

  it("picks the highest-Overall team as leader and the lowest as laggard", () => {
    expect(out.leader.slug).toBe("@acme/frontend");
    expect(out.laggard.slug).toBe("@acme/data");
    expect(out.spread).toBe(80 - 36);
    expect(out.teamCount).toBe(3);
  });

  it("computes the fleet mean overall and per-dimension baselines", () => {
    expect(out.fleetAvgOverall).toBe(Math.round((80 + 58 + 36) / 3)); // 58
    // D1 fleet mean = (90+60+30)/3 = 60
    expect(out.fleetDimAvgs.find((d) => d.dimId === "D1")!.avg).toBe(60);
    // D4 fleet mean = (80+50+20)/3 = 50
    expect(out.fleetDimAvgs.find((d) => d.dimId === "D4")!.avg).toBe(50);
  });

  it("explains the leader with its biggest ABOVE-fleet dimensions (positive deltas, largest first)", () => {
    // frontend deltas vs fleet: D1 +30, D2 +10, D4 +30 → top by magnitude are D1/D4 (+30), then D2 (+10)
    expect(out.leader.factors.every((f) => f.delta > 0)).toBe(true);
    expect(out.leader.factors[0]!.delta).toBe(30);
    expect(out.leader.overallDelta).toBe(80 - 58);
  });

  it("explains the laggard with its biggest BELOW-fleet dimensions (negative deltas, largest drag first)", () => {
    // data deltas vs fleet: D1 -30, D2 -10, D4 -30 → most negative first
    expect(out.laggard.factors.every((f) => f.delta < 0)).toBe(true);
    expect(out.laggard.factors[0]!.delta).toBe(-30);
    expect(out.laggard.overallDelta).toBe(36 - 58);
  });

  it("carries the human/trajectory context (AI-share delta vs fleet, momentum)", () => {
    const fleetAi = Math.round((60 + 30 + 10) / 3); // 33
    expect(out.leader.aiShareDelta).toBe(60 - fleetAi);
    expect(out.laggard.aiShareDelta).toBe(10 - fleetAi);
    expect(out.leader.avgDelta).toBe(8);
    expect(out.laggard.avgDelta).toBe(-4);
  });

  it("carries the contributor population so the renderer can apply the CHAMPION_MIN_POP floor (ambiguity-ui #3)", () => {
    const withPop = explainTeamStandings([
      team("@x/solo", { avgOverall: 80, contributors: 1, champions: [{ login: "one", name: null, aiCommits: 1, aiShare: 100 }] }),
      team("@x/crew", { avgOverall: 40, contributors: 5 }),
    ])!;
    expect(withPop.leader.contributors).toBe(1); // renderer withholds champions below the floor
    expect(withPop.laggard.contributors).toBe(5);
  });

  it("scales bars to the largest |delta| across both extremes", () => {
    expect(out.maxAbsDelta).toBe(30);
  });

  it("falls back to most-divergent dims when a team never diverges in the expected direction", () => {
    // Two teams, identical scores → the 'leader' is above the fleet on nothing; factors must still
    // be populated (magnitude fallback) rather than empty.
    const flat = explainTeamStandings([
      team("@x/a", { avgOverall: 50, dims: [{ dimId: "D1", label: "AI Tooling", avg: 50 }] }),
      team("@x/b", { avgOverall: 50, dims: [{ dimId: "D1", label: "AI Tooling", avg: 50 }] }),
    ])!;
    expect(flat.leader.factors.length).toBeGreaterThan(0);
    expect(flat.maxAbsDelta).toBeGreaterThanOrEqual(1); // never divide-by-zero
  });
});
