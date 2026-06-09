import { describe, it, expect } from "vitest";
import { adoptionMarkdown, type AdoptionOverview } from "./adoption";

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
