// Regression test for the PROCESS SIGNALS unit mismatch (biz-bug-scan-2026-06-11, maturity
// finding #1): PrStats rates are already 0..100 integers, but prompt.ts's local `pct` helper
// re-scaled them ×100 — telling the LLM "merge rate 8500%" on every tokened scan and turning
// the D3/D6/D7/D8 calibration evidence into nonsense.

import { describe, expect, it } from "vitest";
import { buildAssessmentPrompt } from "./prompt";
import type { LlmScoreInput } from "@/lib/llm/provider";
import type { PrStats } from "@/lib/types";

const prStats: PrStats = {
  analyzed: 40,
  totalCount: 120,
  open: 5,
  merged: 34,
  closedUnmerged: 6,
  mergeRate: 85,
  reviewedRate: 92,
  avgReviews: 1.4,
  avgComments: 2.1,
  medianHoursToMerge: 18,
  medianHoursToFirstReview: 3,
  avgLineChanges: 140,
  avgChangedFiles: 4,
  smallPrRate: 60,
  botAuthoredRate: 10,
  aiInvolvedRate: 40,
  aiGovernedRate: 67,
  revertRate: 2,
  draftRate: 5,
  tools: [],
};

function input(overrides: Partial<LlmScoreInput> = {}): LlmScoreInput {
  return {
    repo: {
      owner: "acme",
      name: "rocket",
      url: "https://github.com/acme/rocket",
      stars: 10,
      forks: 2,
      defaultBranch: "main",
    },
    signals: [{ id: "D1", signalScore: 50, signals: [] }],
    files: [],
    commitSample: [],
    archetype: "team",
    prStats,
    governance: null,
    ...overrides,
  };
}

describe("buildAssessmentPrompt — PROCESS SIGNALS rate rendering (#1)", () => {
  it("renders PrStats rates as the 0..100 percentages they already are", () => {
    const { user } = buildAssessmentPrompt(input());
    expect(user).toContain("merge rate 85%");
    expect(user).toContain("reviewed rate 92%");
    expect(user).toContain("small-PR rate 60%");
    expect(user).toContain("AI-involved rate 40%");
    expect(user).toContain("governed (reviewed) rate 67%");
  });

  it("never re-scales an already-percent rate into the thousands", () => {
    const { user } = buildAssessmentPrompt(input());
    expect(user).not.toMatch(/\b\d{3,}%/);
  });

  it("keeps the n/a branch for a null aiGovernedRate", () => {
    const { user } = buildAssessmentPrompt(
      input({ prStats: { ...prStats, aiGovernedRate: null } }),
    );
    expect(user).toContain("governed (reviewed) rate n/a (too few AI PRs)");
  });

  it("renders a null reviewedRate as n/a instead of a fabricated 0% (#3)", () => {
    const { user } = buildAssessmentPrompt(
      input({ prStats: { ...prStats, reviewedRate: null } }),
    );
    expect(user).toContain("reviewed rate n/a (no human-merged PRs)");
    expect(user).not.toContain("reviewed rate 0%");
  });

  it("degrades to the token-less note when prStats and governance are absent", () => {
    const { user } = buildAssessmentPrompt(input({ prStats: null, governance: null }));
    expect(user).toContain("scanned without a token");
  });
});
