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

import { buildAdoptionOverview, adoptionMarkdown, type AdoptionOverview } from "./adoption";

const fixture: AdoptionOverview = {
  org: "acme",
  generatedOn: "2026-06-09",
  contributors: { total: 40, aiActive: 18, aiActiveShare: 45 },
  orgAiShare: 32,
  distribution: { high: 6, some: 12, none: 22 },
  champions: [{ login: "alice", aiShare: 80, commits: 120, aiCommits: 96 }],
  delivery: { typicalHoursToMerge: 18.5, reviewedRate: 72, mergeRate: 88, aiInvolvedRate: 40, prs: 320 },
  knowledgeLeader: { name: "platform", aiCommitShare: 61 },
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
    expect(md).toContain("alice: 80% AI (96/120 commits)");
  });

  it("ends with an enablement ASK", () => {
    expect(md).toContain("## Ask");
    expect(md).toMatch(/3 highest-leverage moves/);
  });

  it("omits the delivery section when there's no PR data", () => {
    expect(adoptionMarkdown({ ...fixture, delivery: null })).not.toContain("Delivery (context");
  });
});

// ── buildAdoptionOverview: the engine that PRODUCES the overview from the aggregates ──────────────
// adoption.ts:38-43 buckets each contributor by personal aiShare (>=50 heavy / >0 partial / else
// none); :36 is the totalContributors===0 ⇒ null empty-guard. Both run for real here.

// Only the fields buildAdoptionOverview reads off each contributor. Cast through unknown so we don't
// hand-build the full ContributorInsight surface (championScore, repoNames, lastActiveAt, …).
type Contrib = { login: string; aiShare: number; commits: number; aiCommits: number };

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

const c = (login: string, aiShare: number): Contrib => ({
  login,
  aiShare,
  commits: 10,
  aiCommits: Math.round((aiShare / 100) * 10),
});

describe("buildAdoptionOverview", () => {
  beforeEach(() => {
    mockGetContributorInsights.mockReset();
    mockGetOrgPrSignals.mockReset();
    mockGetOrgTeamRollup.mockReset();
    // Default: no PR signals, no teams → exercises the delivery/knowledgeLeader null branches.
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

    // Zero-contributor insights (the divide-by-zero / empty-dashboard guard at adoption.ts:36) → null.
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

  it("caps champions at 6 and carries the delivery/knowledgeLeader null branches", async () => {
    const contributors = Array.from({ length: 9 }, (_, i) => c(`u${i}`, 60));
    mockGetContributorInsights.mockResolvedValue(insightsOf(contributors));

    const o = await buildAdoptionOverview("acme");
    expect(o!.champions.length).toBe(6); // slice(0, 6)
    expect(o!.distribution.high).toBe(9); // bucketing is over ALL contributors, not the capped champions
    expect(o!.delivery).toBeNull(); // pr === null ⇒ delivery === null
    expect(o!.knowledgeLeader).toBeNull(); // teams === null ⇒ knowledgeLeader === null
  });

  it("maps PR signals into delivery when present (the non-null branch)", async () => {
    mockGetContributorInsights.mockResolvedValue(insightsOf([c("a", 50)]));
    mockGetOrgPrSignals.mockResolvedValue({
      typicalHoursToMerge: 12.5,
      avgReviewedRate: 80,
      avgMergeRate: 70,
      avgAiInvolvedRate: 40,
      totalPrs: 33,
    });

    const o = await buildAdoptionOverview("acme");
    expect(o!.delivery).toEqual({
      typicalHoursToMerge: 12.5,
      reviewedRate: 80,
      mergeRate: 70,
      aiInvolvedRate: 40,
      prs: 33,
    });
  });
});
