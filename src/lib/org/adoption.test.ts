import { describe, it, expect, vi, beforeEach } from "vitest";

// buildAdoptionOverview pulls its inputs from @/lib/db (contributor insights + PR signals + team
// rollup). Mock ONLY that boundary so the real distribution-bucketing math + null-guards run over
// crafted fleets. (The adoptionMarkdown tests below feed a pre-bucketed fixture, so the bucketing
// and empty-guard logic itself is otherwise unexercised — that's the gap this block closes.)
const { mockGetContributorInsights, mockGetOrgPrSignals, mockGetOrgTeamRollup } = vi.hoisted(() => ({
  mockGetContributorInsights: vi.fn(),
  mockGetOrgPrSignals: vi.fn(),
  mockGetOrgTeamRollup: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getContributorInsights: mockGetContributorInsights,
  getOrgPrSignals: mockGetOrgPrSignals,
  getOrgTeamRollup: mockGetOrgTeamRollup,
}));

import { buildAdoptionOverview, adoptionMarkdown, PAIRING_MIN_GAP, type AdoptionOverview } from "./adoption";

const fixture: AdoptionOverview = {
  org: "acme",
  generatedOn: "2026-06-09",
  contributors: { total: 40, aiActive: 18, aiActiveShare: 45 },
  orgAiShare: 32,
  distribution: { high: 6, some: 12, none: 22 },
  champions: [{ login: "alice", aiShare: 80, commits: 120, aiCommits: 96, repos: 3 }],
  delivery: { typicalHoursToMerge: 18.5, reviewedRate: 72, mergeRate: 88, aiInvolvedRate: 40, aiGovernedRate: 62, prs: 320 },
  knowledgeLeader: { name: "platform", aiCommitShare: 61 },
  tools: [
    { name: "GitHub Copilot", count: 34 },
    { name: "Claude Code", count: 12 },
  ],
  teams: [
    { slug: "@acme/platform", name: "platform", aiCommitShare: 61, contributors: 9, aiContributors: 5, repoCount: 4 },
    { slug: "@acme/data", name: "data", aiCommitShare: 12, contributors: 6, aiContributors: 1, repoCount: 3 },
  ],
  teamPairing: {
    leader: { slug: "@acme/platform", name: "platform", aiCommitShare: 61, contributors: 9, aiContributors: 5, repoCount: 4 },
    learner: { slug: "@acme/data", name: "data", aiCommitShare: 12, contributors: 6, aiContributors: 1, repoCount: 3 },
    gap: 49,
  },
  enablement: [{ login: "bob", name: "Bob", commits: 45, repos: 3, lastActiveAt: "2026-06-01T00:00:00.000Z" }],
};

describe("adoptionMarkdown", () => {
  const md = adoptionMarkdown(fixture);

  it("summarizes adoption, spread and the AI-attributed team leader", () => {
    expect(md).toContain("Org AI commit share: 32% (commit-weighted across contributors)");
    expect(md).toContain("AI-active contributors: 18/40 (45%)");
    expect(md).toContain("6 heavy (>=50% AI) · 12 partial · 22 none");
    expect(md).toContain("Most AI-attributed team: platform (61% AI commit share)");
  });

  it("includes delivery context (clearly non-causal) and champions", () => {
    expect(md).toContain("## Delivery (context — not a causal claim)");
    expect(md).toContain("18.5h typical PR merge time · 72% reviewed · 88% merged · 40% AI-involved PRs (320 PRs)");
    expect(md).toContain("62% of AI PRs human-reviewed");
    expect(md).toContain("alice: 80% AI (96/120 commits across 3 repos)");
  });

  it("lists the detected AI tooling footprint", () => {
    expect(md).toContain("AI tooling detected in PRs: GitHub Copilot ×34, Claude Code ×12");
  });

  it("includes per-team adoption and the suggested mentor→learner pairing", () => {
    expect(md).toContain("## Team adoption (CODEOWNERS)");
    expect(md).toContain("- platform: 61% AI commit share · 5/9 contributors AI-active · 4 repos");
    expect(md).toContain("Suggested pairing: platform (61%) mentors data (12%)");
  });

  it("includes the enablement cohort with the total zero-AI pool for honest scale", () => {
    expect(md).toContain("## Enablement cohort (no AI-attributed commits yet)");
    expect(md).toContain("- bob: 45 commits across 3 repos");
    expect(md).toContain("22 contributors total show no AI-attributed commits");
  });

  it("ends with an enablement ASK", () => {
    expect(md).toContain("## Ask");
    expect(md).toMatch(/3 highest-leverage moves/);
  });

  it("omits the delivery section when there's no PR data", () => {
    expect(adoptionMarkdown({ ...fixture, delivery: null })).not.toContain("Delivery (context");
  });

  it("omits the tools / teams / enablement sections when their inputs are empty", () => {
    const bare = adoptionMarkdown({ ...fixture, tools: [], teams: [], teamPairing: null, enablement: [] });
    expect(bare).not.toContain("AI tooling detected");
    expect(bare).not.toContain("## Team adoption");
    expect(bare).not.toContain("## Enablement cohort");
  });
});

// ── buildAdoptionOverview: the engine that PRODUCES the overview from the aggregates ──────────────
// adoption.ts buckets each contributor by personal aiShare (>=50 heavy / >0 partial / else none);
// the totalContributors===0 ⇒ null empty-guard, the enablement/teams/pairing derivations and the
// delivery/tools mapping all run for real here.

// Only the fields buildAdoptionOverview reads off each contributor. Cast through unknown so we don't
// hand-build the full ContributorInsight surface (championScore, repoNames, …).
type Contrib = {
  login: string;
  name?: string | null;
  aiShare: number;
  commits: number;
  aiCommits: number;
  repos?: number;
  lastActiveAt?: string | null;
};

const insightsOf = (contributors: Contrib[], over: Record<string, unknown> = {}) =>
  ({
    org: "acme",
    totalContributors: contributors.length,
    aiActive: contributors.filter((c) => c.aiCommits > 0).length,
    aiActiveShare: 0,
    orgAiShare: 0,
    soloMaintainerCount: 0,
    contributors,
    champions: contributors,
    concentration: [],
    ...over,
  }) as unknown as Awaited<ReturnType<typeof import("@/lib/db").getContributorInsights>>;

const c = (login: string, aiShare: number, commits = 10): Contrib => ({
  login,
  aiShare,
  commits,
  aiCommits: Math.round((aiShare / 100) * commits),
});

const team = (name: string, aiCommitShare: number, contributors = 5) => ({
  slug: `@acme/${name}`,
  name,
  aiCommitShare,
  contributors,
  aiContributors: Math.min(contributors, Math.round((aiCommitShare / 100) * contributors)),
  repoCount: 2,
});

const rollupOf = (teams: ReturnType<typeof team>[]) =>
  ({ org: "acme", teamCount: teams.length, teams, knowledgeLeader: null, pairing: null }) as unknown as Awaited<
    ReturnType<typeof import("@/lib/db").getOrgTeamRollup>
  >;

describe("buildAdoptionOverview", () => {
  beforeEach(() => {
    mockGetContributorInsights.mockReset();
    mockGetOrgPrSignals.mockReset();
    mockGetOrgTeamRollup.mockReset();
    // Default: no PR signals, no teams → exercises the delivery/knowledgeLeader/teams null branches.
    mockGetOrgPrSignals.mockResolvedValue(null);
    mockGetOrgTeamRollup.mockResolvedValue(null);
  });

  it("buckets each contributor into exactly one of high/some/none at the documented boundaries", async () => {
    // aiShare boundary cases: 0 → none, 1 → some, 49 → some, 50 → high (>=50 is the heavy floor), 80 → high.
    const contributors = [c("zero", 0), c("one", 1), c("low", 49), c("edge", 50), c("heavy", 80)];
    mockGetContributorInsights.mockResolvedValue(insightsOf(contributors));

    const o = await buildAdoptionOverview("acme");
    expect(o).not.toBeNull();
    const dist = o!.distribution;

    // Boundary scores land in the documented bucket: 50 is HEAVY (>=50), 49 is partial, 0 is none.
    expect(dist).toEqual({ high: 2, some: 2, none: 1 });

    // INVARIANT — exactly one bucket each, and the three buckets sum to the contributor count.
    expect(dist.high + dist.some + dist.none).toBe(contributors.length);
  });

  it("never NaNs or double-counts: every contributor lands in one bucket and totals sum to the scanned count", async () => {
    const contributors = [c("a", 0), c("b", 0), c("d", 12), c("e", 100), c("f", 50), c("g", 49)];
    mockGetContributorInsights.mockResolvedValue(insightsOf(contributors));

    const o = await buildAdoptionOverview("acme");
    const dist = o!.distribution;

    // high: e(100), f(50) = 2 · some: d(12), g(49) = 2 · none: a, b = 2.
    expect(dist).toEqual({ high: 2, some: 2, none: 2 });
    expect(Number.isNaN(dist.high) || Number.isNaN(dist.some) || Number.isNaN(dist.none)).toBe(false);
    expect(dist.high + dist.some + dist.none).toBe(contributors.length);
  });

  it("returns null (the documented empty overview) when totalContributors is 0 — no NaN, no crash", async () => {
    // Null insights → null.
    mockGetContributorInsights.mockResolvedValueOnce(null);
    expect(await buildAdoptionOverview("ghost")).toBeNull();

    // Zero-contributor insights (the divide-by-zero / empty-dashboard guard) → null.
    mockGetContributorInsights.mockResolvedValueOnce(insightsOf([], { totalContributors: 0 }));
    expect(await buildAdoptionOverview("empty")).toBeNull();
  });

  it("buckets a partial fleet without dropping or NaN-ing any contributor (null-guard over the loop)", async () => {
    // A lone all-none fleet must still bucket — the empty-guard keys on totalContributors, not aiShare.
    const contributors = [c("solo", 0)];
    mockGetContributorInsights.mockResolvedValue(insightsOf(contributors));

    const o = await buildAdoptionOverview("acme");
    expect(o).not.toBeNull();
    expect(o!.distribution).toEqual({ high: 0, some: 0, none: 1 });
    expect(o!.distribution.high + o!.distribution.some + o!.distribution.none).toBe(1);
  });

  it("caps champions at 6 and carries the delivery/knowledgeLeader/teams null branches", async () => {
    const contributors = Array.from({ length: 9 }, (_, i) => c(`u${i}`, 60));
    mockGetContributorInsights.mockResolvedValue(insightsOf(contributors));

    const o = await buildAdoptionOverview("acme");
    expect(o!.champions.length).toBe(6); // slice(0, 6)
    expect(o!.distribution.high).toBe(9); // bucketing is over ALL contributors, not the capped champions
    expect(o!.delivery).toBeNull(); // pr === null ⇒ delivery === null
    expect(o!.knowledgeLeader).toBeNull(); // teams === null ⇒ knowledgeLeader === null
    expect(o!.tools).toEqual([]); // pr === null ⇒ no tooling footprint
    expect(o!.teams).toEqual([]); // teams === null ⇒ no per-team adoption
    expect(o!.teamPairing).toBeNull();
  });

  it("maps PR signals into delivery (incl. the governed rate) and the tooling footprint when present", async () => {
    mockGetContributorInsights.mockResolvedValue(insightsOf([c("a", 50)]));
    mockGetOrgPrSignals.mockResolvedValue({
      typicalHoursToMerge: 12.5,
      avgReviewedRate: 80,
      avgMergeRate: 70,
      avgAiInvolvedRate: 40,
      avgAiGovernedRate: 65,
      totalPrs: 33,
      tools: [{ name: "Claude Code", count: 7 }],
    });

    const o = await buildAdoptionOverview("acme");
    expect(o!.delivery).toEqual({
      typicalHoursToMerge: 12.5,
      reviewedRate: 80,
      mergeRate: 70,
      aiInvolvedRate: 40,
      aiGovernedRate: 65,
      prs: 33,
    });
    expect(o!.tools).toEqual([{ name: "Claude Code", count: 7 }]);
  });

  it("derives the enablement cohort: zero-AI only, ≥3 commits, volume order, capped at 8", async () => {
    const contributors = [
      // insights.contributors arrive sorted by commits desc (the real aggregate guarantees it).
      { ...c("big", 0, 90), name: "Big", repos: 4, lastActiveAt: "2026-06-01T00:00:00.000Z" },
      c("ai-user", 40, 80), // AI-active → excluded even at high volume
      ...Array.from({ length: 9 }, (_, i) => c(`z${i}`, 0, 50 - i)), // 9 more zero-AI → cap bites
      c("driveby", 0, 2), // below the 3-commit floor → excluded
    ];
    mockGetContributorInsights.mockResolvedValue(insightsOf(contributors));

    const o = await buildAdoptionOverview("acme");
    expect(o!.enablement.length).toBe(8); // 10 qualify, capped at 8
    expect(o!.enablement[0]).toEqual({ login: "big", name: "Big", commits: 90, repos: 4, lastActiveAt: "2026-06-01T00:00:00.000Z" });
    expect(o!.enablement.map((e) => e.login)).not.toContain("ai-user");
    expect(o!.enablement.map((e) => e.login)).not.toContain("driveby");
  });

  it("sorts teams by AI share and pairs top↔bottom only when the gap clears the floor", async () => {
    mockGetContributorInsights.mockResolvedValue(insightsOf([c("a", 50)]));
    mockGetOrgTeamRollup.mockResolvedValue(rollupOf([team("data", 12), team("platform", 61), team("web", 30)]));

    const o = await buildAdoptionOverview("acme");
    expect(o!.teams.map((t) => t.name)).toEqual(["platform", "web", "data"]); // re-sorted by aiCommitShare desc
    expect(o!.teamPairing).toMatchObject({ leader: { name: "platform" }, learner: { name: "data" }, gap: 49 });
  });

  it("suggests no pairing below the gap floor, for a lone team, or when the low team has nobody to enable", async () => {
    mockGetContributorInsights.mockResolvedValue(insightsOf([c("a", 50)]));

    // Gap below the floor → null.
    mockGetOrgTeamRollup.mockResolvedValueOnce(rollupOf([team("platform", 40), team("web", 40 - PAIRING_MIN_GAP + 1)]));
    expect((await buildAdoptionOverview("acme"))!.teamPairing).toBeNull();

    // A single team can't pair.
    mockGetOrgTeamRollup.mockResolvedValueOnce(rollupOf([team("platform", 61)]));
    expect((await buildAdoptionOverview("acme"))!.teamPairing).toBeNull();

    // The only low team has 0 contributors (nothing to enable) → null.
    mockGetOrgTeamRollup.mockResolvedValueOnce(rollupOf([team("platform", 61), team("ghost", 0, 0)]));
    expect((await buildAdoptionOverview("acme"))!.teamPairing).toBeNull();
  });

  it("threads the segment/stack scope into every aggregate it assembles", async () => {
    mockGetContributorInsights.mockResolvedValue(insightsOf([c("a", 50)]));

    await buildAdoptionOverview("acme", "seg-1", "tg-9");
    expect(mockGetContributorInsights).toHaveBeenCalledWith("acme", "seg-1", "tg-9");
    expect(mockGetOrgPrSignals).toHaveBeenCalledWith("acme", "seg-1", "tg-9");
    expect(mockGetOrgTeamRollup).toHaveBeenCalledWith("acme", "seg-1", "tg-9");
  });
});
