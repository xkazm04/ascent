// The ship loop's pure rules: triage ranking (biggest lever first), merged-PR impact math (the
// number the whole loop exists to produce), and the mock-PR merge clock (dev demo pacing). All
// pure — the DB/GitHub plumbing around them is mocked out so this suite never reaches for either.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ getPrisma: vi.fn(), isDbConfigured: () => false }));
vi.mock("@/lib/db/installations", () => ({ getInstallationIdForOwner: vi.fn() }));
vi.mock("@/lib/db/scans-recommendations", () => ({ updateRecommendation: vi.fn() }));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: vi.fn(), isAppConfigured: () => false }));
vi.mock("@/lib/github/write", () => ({ getPullRequest: vi.fn() }));
vi.mock("@/lib/practices/apply", () => ({ applyPracticeToRepo: vi.fn() }));

import { computePrImpact, mockPrShouldMerge, rankTriage, MOCK_MERGE_MS } from "@/lib/db/improvement";

const t = (impact: string, effort: string, title = "x") => ({ impact, effort, title });

describe("rankTriage — biggest lever first", () => {
  it("orders by impact high→low before anything else", () => {
    const ranked = rankTriage([t("low", "low", "a"), t("high", "high", "b"), t("medium", "low", "c")]);
    expect(ranked.map((r) => r.impact)).toEqual(["high", "medium", "low"]);
  });

  it("breaks impact ties by effort low→high (quick wins first)", () => {
    const ranked = rankTriage([t("high", "high", "slow"), t("high", "low", "quick")]);
    expect(ranked.map((r) => r.title)).toEqual(["quick", "slow"]);
  });

  it("breaks full ties by title for a stable board", () => {
    const ranked = rankTriage([t("high", "low", "beta"), t("high", "low", "alpha")]);
    expect(ranked.map((r) => r.title)).toEqual(["alpha", "beta"]);
  });

  it("sinks unknown impact/effort values below known ones instead of throwing", () => {
    const ranked = rankTriage([t("??", "low", "weird"), t("low", "high", "known")]);
    expect(ranked.map((r) => r.title)).toEqual(["known", "weird"]);
  });

  it("does not mutate its input", () => {
    const input = [t("low", "low", "a"), t("high", "low", "b")];
    rankTriage(input);
    expect(input.map((r) => r.title)).toEqual(["a", "b"]);
  });
});

describe("computePrImpact — merged PR vs baseline scan", () => {
  const scores = (overall: number, d3: number) => ({ overall, dims: [{ dimId: "D3", score: d3 }] });

  it("measures the practice's own dimension delta + the overall delta", () => {
    expect(computePrImpact("D3", scores(58, 40), scores(63, 55))).toEqual({ impactDim: 15, impactOverall: 5 });
  });

  it("reports a regression honestly (negative deltas)", () => {
    expect(computePrImpact("D3", scores(60, 50), scores(57, 44))).toEqual({ impactDim: -6, impactOverall: -3 });
  });

  it("yields nulls without a baseline scan — never invents a zero", () => {
    expect(computePrImpact("D3", null, scores(63, 55))).toEqual({ impactDim: null, impactOverall: null });
  });

  it("nulls the dim delta when either side lacks that dimension, keeping the overall delta", () => {
    const noDim = { overall: 60, dims: [] };
    expect(computePrImpact("D3", noDim, scores(63, 55))).toEqual({ impactDim: null, impactOverall: 3 });
    expect(computePrImpact("D3", scores(60, 50), { overall: 63, dims: [] })).toEqual({ impactDim: null, impactOverall: 3 });
  });
});

describe("mockPrShouldMerge — the dev demo merge clock", () => {
  const opened = new Date("2026-07-03T10:00:00Z");

  it("stays open before the delay elapses", () => {
    expect(mockPrShouldMerge(opened, new Date(opened.getTime() + MOCK_MERGE_MS - 1))).toBe(false);
  });

  it("merges once the delay has elapsed (inclusive)", () => {
    expect(mockPrShouldMerge(opened, new Date(opened.getTime() + MOCK_MERGE_MS))).toBe(true);
  });
});
