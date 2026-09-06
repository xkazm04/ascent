import { describe, expect, it } from "vitest";
import { explainTeamStandings } from "@/lib/org/teamStandings";
import type { TeamRepoScore, TeamRollup } from "@/lib/db/org-teams";

// Pure decomposition of the team standings: rank by avgOverall, then attribute each extreme's
// distance from the fleet mean to the dimensions driving it. No DB — mirrors teamRollup.test's
// "test the pure transform" approach.

/** One owned repo at a given overall score. `mock` marks the deterministic floor (never a grade). */
export function repo(fullName: string, overall: number, mock = false): TeamRepoScore {
  return {
    fullName,
    name: fullName.split("/").pop()!,
    overall,
    adoption: overall,
    rigor: overall,
    level: "L3",
    posture: "manual",
    isDefaultOwner: true,
    mock,
  };
}

function team(slug: string, over: Partial<TeamRollup> & { dims?: { dimId: string; label: string; avg: number }[] }): TeamRollup {
  const { dims, ...rest } = over;
  // A team's `repos` is the population `fleetAvgOverall` is now measured over, so the default fixture
  // gives each team ONE repo carrying its avgOverall — the mean of team means and the per-repo mean
  // coincide there, which is what keeps the pre-existing expectations below unchanged.
  const defaultRepos = [repo(`${slug.replace("@", "")}/r`, over.avgOverall ?? 50)];
  return {
    slug,
    name: slug.split("/")[1] ?? slug,
    repoCount: 1,
    realScoredCount: 1,
    mockCount: 0,
    totalOwned: 1,
    defaultOwnerCount: 0,
    repos: defaultRepos,
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
    onboardedRepos: 0,
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
    // One repo per team, each at the team's avgOverall — so the per-repo mean is (80+58+36)/3 = 58.
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

// ── fleetAvgOverall is a per-repo mean, not a mean of team means (fleet-rollups-insights) ─────────
// Teams SHARE repos (a repo is attributed to every CODEOWNERS team that owns part of it) and differ
// wildly in size, so averaging team averages double-counted shared repos and gave a two-repo team the
// same weight as a forty-repo one — while the figure was rendered beside the org rollup's per-repo
// fleet average with no label to tell them apart.
describe("explainTeamStandings — fleetAvgOverall population", () => {
  it("counts a repo SHARED by two teams exactly once", () => {
    // `shared` (score 100) is owned by both teams; `solo` scores 40. The honest per-repo mean is
    // (100+40)/2 = 70. A mean of team means would be (100 + 70)/2 = 85 — the shared repo voting twice.
    const shared = repo("acme/shared", 100);
    const teams = [
      team("@acme/a", { avgOverall: 100, repos: [shared] }),
      team("@acme/b", { avgOverall: 70, repos: [shared, repo("acme/solo", 40)], repoCount: 2, realScoredCount: 2 }),
    ];
    expect(explainTeamStandings(teams)!.fleetAvgOverall).toBe(70);
  });

  it("weighs a large team by its repos, not by being one row in the list", () => {
    // Team `big` owns four repos at 40; `small` owns one at 100. Per-repo mean = (40*4 + 100)/5 = 52.
    // Mean of team means would be (40 + 100)/2 = 70 — an 18-point overstatement of the fleet.
    const teams = [
      team("@acme/small", { avgOverall: 100, repos: [repo("acme/s1", 100)] }),
      team("@acme/big", {
        avgOverall: 40,
        repoCount: 4,
        realScoredCount: 4,
        repos: [repo("acme/b1", 40), repo("acme/b2", 40), repo("acme/b3", 40), repo("acme/b4", 40)],
      }),
    ];
    expect(explainTeamStandings(teams)!.fleetAvgOverall).toBe(52);
  });

  it("EXCLUDES a mock-floor repo from the fleet mean (a placeholder is not a measurement)", () => {
    // Same exclusion as getOrgRollup's averages: the mock row at 10 would drag a 70-point fleet to 50.
    const teams = [
      team("@acme/a", { avgOverall: 70, repos: [repo("acme/a1", 70)] }),
      team("@acme/b", {
        avgOverall: 70,
        repoCount: 2,
        realScoredCount: 1,
        mockCount: 1,
        repos: [repo("acme/b1", 70), repo("acme/b2", 10, true)],
      }),
    ];
    expect(explainTeamStandings(teams)!.fleetAvgOverall).toBe(70);
  });
});
