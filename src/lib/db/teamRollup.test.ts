import { describe, expect, it } from "vitest";
import { rollupTeams, type TeamRollupRepoInput } from "@/lib/db/org";

// Pure aggregation behind getOrgTeamRollup — buckets repos into their CODEOWNERS teams and rolls
// each up (maturity, dimension shape, AI-knowledge, movers) with no DB. Mirrors discover.test's
// "test the pure transform" approach.

type Dim = { dimId: string; score: number };

function repo(
  fullName: string,
  opts: {
    teams?: { slug: string; isDefaultOwner?: boolean }[];
    scans?: { overall: number; adoption: number; rigor: number; dims: Dim[] }[]; // most-recent first
    contributors?: { login: string; commits: number; aiCommits: number }[];
  } = {},
): TeamRollupRepoInput {
  return {
    fullName,
    name: fullName.split("/")[1] ?? fullName,
    teams: (opts.teams ?? []).map((t) => ({ slug: t.slug, ownedPaths: 1, isDefaultOwner: t.isDefaultOwner ?? false })),
    scans: (opts.scans ?? []).map((s) => ({
      overallScore: s.overall,
      adoptionScore: s.adoption,
      rigorScore: s.rigor,
      level: "L3",
      posture: "ai-native",
      dimensions: s.dims,
    })),
    contributors: (opts.contributors ?? []).map((c) => ({ login: c.login, name: null, commits: c.commits, aiCommits: c.aiCommits })),
  };
}

const FLEET: TeamRollupRepoInput[] = [
  repo("acme/web", {
    teams: [{ slug: "@acme/frontend", isDefaultOwner: true }],
    scans: [
      { overall: 80, adoption: 85, rigor: 75, dims: [{ dimId: "D1", score: 85 }, { dimId: "D2", score: 70 }, { dimId: "D8", score: 80 }] },
      { overall: 70, adoption: 70, rigor: 70, dims: [{ dimId: "D1", score: 70 }] }, // prior scan → movers
    ],
    contributors: [
      { login: "alice", commits: 10, aiCommits: 9 },
      { login: "build[bot]", commits: 40, aiCommits: 0 }, // bot — excluded from team AI knowledge
    ],
  }),
  repo("acme/api", {
    teams: [{ slug: "@acme/data", isDefaultOwner: true }],
    scans: [
      { overall: 38, adoption: 30, rigor: 45, dims: [{ dimId: "D1", score: 30 }, { dimId: "D2", score: 55 }, { dimId: "D8", score: 25 }] },
    ],
    contributors: [
      { login: "carol", commits: 8, aiCommits: 0 },
      { login: "dan", commits: 4, aiCommits: 1 },
    ],
  }),
  repo("acme/docs", { teams: [{ slug: "@acme/frontend" }] }), // owned but never scanned
  repo("acme/infra", {
    scans: [{ overall: 50, adoption: 50, rigor: 50, dims: [{ dimId: "D1", score: 50 }] }], // no CODEOWNERS team → unowned
    contributors: [{ login: "eve", commits: 3, aiCommits: 0 }],
  }),
];

describe("rollupTeams", () => {
  const out = rollupTeams("acme", FLEET);
  const frontend = out.teams.find((t) => t.slug === "@acme/frontend")!;
  const data = out.teams.find((t) => t.slug === "@acme/data")!;

  it("counts attributed vs unowned scanned repos", () => {
    expect(out.attributedRepos).toBe(2); // web + api (docs has a team but no scan)
    expect(out.unownedRepos).toBe(1); // infra
    expect(out.teamCount).toBe(2);
  });

  it("sorts teams by repo count then maturity", () => {
    // both teams own 1 scored repo, so the more mature (frontend, 80) leads
    expect(out.teams.map((t) => t.slug)).toEqual(["@acme/frontend", "@acme/data"]);
  });

  it("rolls a team's owned+scanned repos into maturity averages and posture", () => {
    expect(frontend.repoCount).toBe(1);
    expect(frontend.totalOwned).toBe(2); // web + docs
    expect(frontend.defaultOwnerCount).toBe(1); // web's "*"
    expect(frontend.avgOverall).toBe(80);
    expect(frontend.avgAdoption).toBe(85);
    expect(frontend.posture).toBe("ai-native");
    expect(data.posture).toBe("early");
  });

  it("derives strongest and weakest dimensions per team", () => {
    expect(frontend.strongest).toMatchObject({ dimId: "D1", avg: 85 });
    expect(frontend.weakest).toMatchObject({ dimId: "D2", avg: 70 });
    expect(data.weakest).toMatchObject({ dimId: "D8", avg: 25 });
  });

  it("merges human contributors across the team's repos for AI knowledge (bots excluded)", () => {
    expect(frontend.contributors).toBe(1); // alice only; build[bot] dropped
    expect(frontend.aiCommitShare).toBe(90); // 9/10
    expect(frontend.aiContributors).toBe(1);
    expect(frontend.champions[0]).toMatchObject({ login: "alice", aiShare: 90 });
    expect(data.aiCommitShare).toBe(8); // 1 / (8+4)
  });

  it("computes since-last-scan movers from each repo's two latest scans", () => {
    expect(frontend.comparedRepos).toBe(1);
    expect(frontend.improving).toBe(1);
    expect(frontend.avgDelta).toBe(10); // 80 - 70
    expect(data.comparedRepos).toBe(0); // api has a single scan
  });

  it("names the knowledge leader (most AI-attributed + AI-native)", () => {
    expect(out.knowledgeLeader?.slug).toBe("@acme/frontend");
    expect(out.knowledgeLeader?.aiCommitShare).toBe(90);
  });

  it("suggests the biggest strong→weak cross-team pairing on a shared dimension", () => {
    expect(out.pairing).toMatchObject({
      mentorSlug: "@acme/frontend",
      learnerSlug: "@acme/data",
      dimId: "D1",
      mentorScore: 85,
      learnerScore: 30,
      gap: 55,
    });
  });
});

describe("rollupTeams — empty / no-team fleets", () => {
  it("returns an empty, well-formed shape when no repo has a CODEOWNERS team", () => {
    const out = rollupTeams("acme", [repo("acme/solo", { scans: [{ overall: 50, adoption: 50, rigor: 50, dims: [] }] })]);
    expect(out.teams).toEqual([]);
    expect(out.teamCount).toBe(0);
    expect(out.attributedRepos).toBe(0);
    expect(out.unownedRepos).toBe(1);
    expect(out.knowledgeLeader).toBeNull();
    expect(out.pairing).toBeNull();
  });

  it("yields no pairing when only one team exists", () => {
    const out = rollupTeams("acme", [
      repo("acme/web", { teams: [{ slug: "@acme/frontend" }], scans: [{ overall: 80, adoption: 80, rigor: 80, dims: [{ dimId: "D1", score: 80 }] }] }),
    ]);
    expect(out.teamCount).toBe(1);
    expect(out.pairing).toBeNull();
  });
});
