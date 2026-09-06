import { describe, expect, it } from "vitest";
// Import the concrete module (not the org barrel) so this pure-transform test doesn't pull in the
// whole db family it never touches.
import { rollupTeams, type TeamRollupRepoInput } from "@/lib/db/org-teams";

// Pure aggregation behind getOrgTeamRollup — buckets repos into their CODEOWNERS teams and rolls
// each up (maturity, dimension shape, AI-knowledge, movers) with no DB. Mirrors discover.test's
// "test the pure transform" approach.

type Dim = { dimId: string; score: number };

function repo(
  fullName: string,
  opts: {
    teams?: { slug: string; isDefaultOwner?: boolean }[];
    scans?: { overall: number; adoption: number; rigor: number; dims: Dim[]; engine?: string }[]; // most-recent first
    contributors?: { login: string; commits: number; aiCommits: number }[];
    windowDelta?: number | null;
    windowBaselineKind?: "period" | "onboarded";
  } = {},
): TeamRollupRepoInput {
  const windowed = "windowDelta" in opts ? { windowDelta: opts.windowDelta, windowBaselineKind: opts.windowBaselineKind } : {};
  return {
    ...windowed,
    fullName,
    name: fullName.split("/")[1] ?? fullName,
    teams: (opts.teams ?? []).map((t) => ({ slug: t.slug, ownedPaths: 1, isDefaultOwner: t.isDefaultOwner ?? false })),
    scans: (opts.scans ?? []).map((s) => ({
      overallScore: s.overall,
      adoptionScore: s.adoption,
      rigorScore: s.rigor,
      level: "L3",
      posture: "ai-native",
      // Default to a live engine; "mock" is the deterministic FLOOR the rollup must never grade.
      engineProvider: s.engine ?? "anthropic",
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

  it("lists the unowned scanned repos weakest-first (the CODEOWNERS follow-up list)", () => {
    expect(out.unowned).toEqual([{ fullName: "acme/infra", name: "infra", overall: 50 }]);
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
    expect(data.aiCommitShare).toBe(8); // 1 / (8+4)
    // The AI-knowledge AGGREGATES are all present; the named list is not — a 1-person team is below
    // the privacy floor (pinned in its own block below).
    expect(frontend.champions).toEqual([]);
  });

  it("champion volume floor: a sub-3-commit AI contributor is not crowned (ambiguity-ui #3)", () => {
    // Aligned with getContributorInsights' picker (commits >= 3 && aiCommits > 0): a 1-commit
    // drive-by AI contributor must not headline a team card the Contributors tab would withhold.
    // Three humans, so the POPULATION floor is satisfied and the volume floor is what's under test.
    const floored = rollupTeams("acme", [
      repo("acme/tiny", {
        teams: [{ slug: "@acme/tiny" }],
        scans: [{ overall: 50, adoption: 50, rigor: 50, dims: [{ dimId: "D1", score: 50 }] }],
        contributors: [
          { login: "driveby", commits: 1, aiCommits: 1 },
          { login: "core", commits: 12, aiCommits: 4 },
          { login: "pad", commits: 9, aiCommits: 0 },
        ],
      }),
    ]);
    const tiny = floored.teams.find((t) => t.slug === "@acme/tiny")!;
    expect(tiny.champions.map((c) => c.login)).toEqual(["core"]);
  });

  it("computes since-last-scan movers from each repo's two latest scans", () => {
    expect(frontend.comparedRepos).toBe(1);
    expect(frontend.improving).toBe(1);
    expect(frontend.avgDelta).toBe(10); // 80 - 70
    expect(data.comparedRepos).toBe(0); // api has a single scan
  });

  it("elects NO knowledge leader when every AI-active team is below the naming floor", () => {
    // frontend has 1 contributor and data has 2 — both under CHAMPION_MIN_POP. "@acme/frontend is the
    // org's AI knowledge leader" would name alice by proxy on the Teams tile, the Adoption spectrum
    // and in the Copy-for-LLM brief, so the producer elects nobody (G4-01).
    expect(out.knowledgeLeader).toBeNull();
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

  it("ranks one pairing per qualifying dimension, biggest gap first, headline = pairings[0]", () => {
    // D1 (85→30) and D8 (80→25) both qualify with a 55 gap (tie → dimId order); D2 doesn't (learner 55 ≥ TEAM_WEAK).
    expect(out.pairings.map((p) => p.dimId)).toEqual(["D1", "D8"]);
    expect(out.pairings[0]).toEqual(out.pairing);
  });
});

// ── the CHAMPION_MIN_POP privacy floor, enforced in the PRODUCER (G4-01) ───────────
// TeamsStandings and TeamsMatrixDetail each re-implemented `contributors >= CHAMPION_MIN_POP` in JSX;
// rollupTeams itself applied no population floor at all, so any non-React consumer (CSV export, the
// briefing/digest paths, an OG image) could name the sole AI user of a two-person team. The floor now
// lives here, which is why the fixtures above see empty champion lists.
describe("rollupTeams — population floor on named individuals", () => {
  const scan = { overall: 60, adoption: 60, rigor: 60, dims: [{ dimId: "D1", score: 60 }] };
  const teamOf = (slug: string, contributors: { login: string; commits: number; aiCommits: number }[]) =>
    repo(`acme/${slug}`, { teams: [{ slug: `@acme/${slug}` }], scans: [scan], contributors });

  it("names NO champion on a 2-person team, however qualified, while keeping the aggregates", () => {
    const out = rollupTeams("acme", [
      teamOf("duo", [
        { login: "ada", commits: 40, aiCommits: 36 },
        { login: "bo", commits: 10, aiCommits: 0 },
      ]),
    ]);
    const duo = out.teams[0]!;
    expect(duo.contributors).toBe(2);
    expect(duo.champions).toEqual([]);
    expect(duo.aiCommitShare).toBe(72); // 36/50 — the aggregate is untouched
    expect(duo.aiContributors).toBe(1);
    expect(JSON.stringify(out)).not.toContain("ada"); // nothing to serialize downstream
  });

  it("names champions at exactly 3 contributors, and elects a knowledge leader only from such a team", () => {
    const out = rollupTeams("acme", [
      teamOf("trio", [
        { login: "ada", commits: 40, aiCommits: 36 },
        { login: "bo", commits: 10, aiCommits: 0 },
        { login: "cy", commits: 8, aiCommits: 0 },
      ]),
      teamOf("duo", [
        // Higher AI share, but 2 people — must NOT outrank (or even enter) the leader election.
        { login: "eve", commits: 20, aiCommits: 20 },
        { login: "fin", commits: 5, aiCommits: 0 },
      ]),
    ]);
    const trio = out.teams.find((t) => t.slug === "@acme/trio")!;
    expect(trio.champions.map((c) => c.login)).toEqual(["ada"]);
    expect(out.knowledgeLeader?.slug).toBe("@acme/trio");
  });
});

describe("rollupTeams — period-scoped movers via windowDelta (fleet-rollups-insights 07-16 #2)", () => {
  const team = { teams: [{ slug: "@acme/frontend" }] };
  const scan = (overall: number) => ({ overall, adoption: overall, rigor: overall, dims: [] as Dim[] });

  it("uses the precomputed windowed delta INSTEAD of latest-vs-previous when windowDelta is a number", () => {
    // Latest two scans say +10 (80 vs 70), but the selected period's half-open baseline says −5.
    // The Teams tab must report the PERIOD number, not the cadence-dependent since-last-scan one.
    const r = { ...repo("acme/web", { ...team, scans: [scan(80), scan(70)] }), windowDelta: -5 };
    const out = rollupTeams("acme", [r]);
    const t = out.teams[0]!;
    expect(t.comparedRepos).toBe(1);
    expect(t.avgDelta).toBe(-5);
    expect(t.improving).toBe(0);
    expect(t.declining).toBe(1);
  });

  it("windowDelta: null EXCLUDES the repo from movers (no silent since-last-scan fallback mixing scopes)", () => {
    // The repo has two scans (legacy movers would compare them), but the window has no comparable pair.
    const r = { ...repo("acme/web", { ...team, scans: [scan(80), scan(70)] }), windowDelta: null };
    const out = rollupTeams("acme", [r]);
    const t = out.teams[0]!;
    expect(t.comparedRepos).toBe(0);
    expect(t.avgDelta).toBe(0);
    // The snapshot side is untouched — the repo still contributes its latest scan to the averages.
    expect(t.avgOverall).toBe(80);
  });

  it("windowDelta absent (windowless caller) keeps the legacy since-last-scan movers", () => {
    const out = rollupTeams("acme", [repo("acme/web", { ...team, scans: [scan(80), scan(70)] })]);
    expect(out.teams[0]!.comparedRepos).toBe(1);
    expect(out.teams[0]!.avgDelta).toBe(10);
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
    expect(out.pairings).toEqual([]);
  });

  it("yields no pairing when only one team exists", () => {
    const out = rollupTeams("acme", [
      repo("acme/web", { teams: [{ slug: "@acme/frontend" }], scans: [{ overall: 80, adoption: 80, rigor: 80, dims: [{ dimId: "D1", score: 80 }] }] }),
    ]);
    expect(out.teamCount).toBe(1);
    expect(out.pairing).toBeNull();
  });
});

// ── The deterministic mock FLOOR never enters a team average or a team mover ──────────────────────
// getOrgRollup has excluded `engineProvider: "mock"` from its fleet averages and cohort deltas since
// 2026-09-05; this rollup folded it in, so the SAME fleet reported one maturity number on the badge
// and a different one on the Teams table — and a mock→live re-scan read as the team improving.
describe("rollupTeams — mock-floor exclusion", () => {
  const fleet: TeamRollupRepoInput[] = [
    repo("acme/live", {
      teams: [{ slug: "@acme/core", isDefaultOwner: true }],
      scans: [{ overall: 80, adoption: 80, rigor: 80, dims: [{ dimId: "D1", score: 80 }] }],
    }),
    repo("acme/placeholder", {
      teams: [{ slug: "@acme/core" }],
      scans: [{ overall: 20, adoption: 20, rigor: 20, dims: [{ dimId: "D1", score: 20 }], engine: "mock" }],
    }),
  ];
  const core = rollupTeams("acme", fleet).teams.find((t) => t.slug === "@acme/core")!;

  it("keeps the mock repo out of the averages and states the denominator it used", () => {
    expect(core.avgOverall).toBe(80); // NOT avg(80, 20) = 50
    expect(core.avgAdoption).toBe(80);
    expect(core.avgRigor).toBe(80);
    expect(core.realScoredCount).toBe(1);
    expect(core.mockCount).toBe(1);
    // The repo COUNT and the repo LIST still describe every scanned repo — a count is a count.
    expect(core.repoCount).toBe(2);
    expect(core.repos.map((r) => r.fullName).sort()).toEqual(["acme/live", "acme/placeholder"]);
    expect(core.repos.find((r) => r.fullName === "acme/placeholder")!.mock).toBe(true);
  });

  it("keeps the mock repo's dimension scores out of the dimension bars", () => {
    expect(core.dimAverages.find((d) => d.dimId === "D1")!.avg).toBe(80); // NOT 50
  });

  it("omits a team whose every scanned repo is a mock placeholder (rather than grading it 0)", () => {
    const out = rollupTeams("acme", [
      repo("acme/m1", {
        teams: [{ slug: "@acme/ghost" }],
        scans: [{ overall: 20, adoption: 20, rigor: 20, dims: [{ dimId: "D1", score: 20 }], engine: "mock" }],
      }),
      ...fleet,
    ]);
    expect(out.teams.find((t) => t.slug === "@acme/ghost")).toBeUndefined();
    // The repo is still ATTRIBUTED — the exclusion is about grades, not about ownership.
    expect(out.attributedRepos).toBe(3);
  });

  it("refuses a since-last-scan delta whose endpoints cross engines (mock → live is not movement)", () => {
    const out = rollupTeams("acme", [
      repo("acme/promoted", {
        teams: [{ slug: "@acme/core" }],
        scans: [
          { overall: 75, adoption: 75, rigor: 75, dims: [{ dimId: "D1", score: 75 }] },
          { overall: 20, adoption: 20, rigor: 20, dims: [{ dimId: "D1", score: 20 }], engine: "mock" }, // the floor it was on
        ],
      }),
      repo("acme/real", {
        teams: [{ slug: "@acme/core" }],
        scans: [
          { overall: 60, adoption: 60, rigor: 60, dims: [{ dimId: "D1", score: 60 }] },
          { overall: 55, adoption: 55, rigor: 55, dims: [{ dimId: "D1", score: 55 }] },
        ],
      }),
    ]);
    const core2 = out.teams.find((t) => t.slug === "@acme/core")!;
    // Only the real pair (+5) is compared; the +55 engine transition never becomes team momentum.
    expect(core2.comparedRepos).toBe(1);
    expect(core2.improving).toBe(1);
    expect(core2.avgDelta).toBe(5);
  });
});

// ── An ONBOARDED repo's lifetime delta is segregated, exactly as getOrgMovers segregates it ───────
// A repo with no pre-window baseline moves from its FIRST EVER score, not from where the period
// started. Folding that into improving/avgDelta/comparedRepos overstated team momentum for precisely
// the periods an org is onboarding repos (G4-06).
describe("rollupTeams — onboarded repos are reported separately from period movers", () => {
  const out = rollupTeams("acme", [
    repo("acme/established", {
      teams: [{ slug: "@acme/core" }],
      scans: [{ overall: 70, adoption: 70, rigor: 70, dims: [{ dimId: "D1", score: 70 }] }],
      windowDelta: 4,
      windowBaselineKind: "period",
    }),
    repo("acme/brand-new", {
      teams: [{ slug: "@acme/core" }],
      scans: [{ overall: 60, adoption: 60, rigor: 60, dims: [{ dimId: "D1", score: 60 }] }],
      windowDelta: 45, // its whole life, compressed into this window
      windowBaselineKind: "onboarded",
    }),
  ]);
  const core = out.teams.find((t) => t.slug === "@acme/core")!;

  it("counts only the real period baseline in comparedRepos / improving / avgDelta", () => {
    expect(core.comparedRepos).toBe(1);
    expect(core.improving).toBe(1);
    expect(core.declining).toBe(0);
    expect(core.avgDelta).toBe(4); // NOT avg(4, 45) = 25
  });

  it("still reports the onboarded repo — segregated, never dropped", () => {
    expect(core.onboardedRepos).toBe(1);
    // Its SNAPSHOT state is unaffected: onboarding changes what a delta means, not what a score is.
    expect(core.repoCount).toBe(2);
    expect(core.avgOverall).toBe(65);
  });

  it("reports no onboarding in the unwindowed (since-last-scan) mode, where the concept doesn't apply", () => {
    const legacy = rollupTeams("acme", [
      repo("acme/a", {
        teams: [{ slug: "@acme/core" }],
        scans: [
          { overall: 70, adoption: 70, rigor: 70, dims: [{ dimId: "D1", score: 70 }] },
          { overall: 60, adoption: 60, rigor: 60, dims: [{ dimId: "D1", score: 60 }] },
        ],
      }),
      repo("acme/b", {
        teams: [{ slug: "@acme/core" }],
        scans: [{ overall: 50, adoption: 50, rigor: 50, dims: [{ dimId: "D1", score: 50 }] }],
      }),
    ]);
    const core2 = legacy.teams.find((t) => t.slug === "@acme/core")!;
    expect(core2.onboardedRepos).toBe(0);
    expect(core2.comparedRepos).toBe(1);
  });
});
