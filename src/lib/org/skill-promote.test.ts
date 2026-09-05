// Unit tests for the promotion bridge (generated onboarding skill -> org Skills Library entry). The
// route around it is auth + persist; everything that decides WHAT gets filed lives here, so this is
// where the bridge's contract is pinned: a repo-derived name (no cross-repo collision), the ai-native
// category, the generator's description preserved, and a body that satisfies the frontmatter contract.

import { describe, it, expect } from "vitest";
import { DIMENSIONS, levelForScore } from "@/lib/maturity/model";
import type { DimensionId, ScanReport } from "@/lib/types";
import { buildPromotedSkill, promotedSkillName, PROMOTED_SKILL_CATEGORY } from "@/lib/org/skill-promote";
import { parseSkillFrontmatter } from "@/lib/org/skill-frontmatter";

function makeReport(
  scores: Partial<Record<DimensionId, number>> = {},
  repo: { owner: string; name: string } = { owner: "Acme", name: "Billing.API" },
  overall = 58,
): ScanReport {
  const dimensions = DIMENSIONS.map((d) => ({
    id: d.id,
    name: d.name,
    weight: d.weight,
    score: scores[d.id] ?? 40,
    signalScore: scores[d.id] ?? 40,
    llmScore: scores[d.id] ?? 40,
    summary: `${d.name} summary`,
    evidence: [],
    strengths: [`${d.id} strength`],
    gaps: [`${d.id} gap one`],
  }));
  return {
    repo: {
      owner: repo.owner,
      name: repo.name,
      url: `https://github.com/${repo.owner}/${repo.name}`,
      description: "Billing API",
      stars: 12,
      forks: 1,
      primaryLanguage: "TypeScript",
      defaultBranch: "main",
    },
    overallScore: overall,
    level: levelForScore(overall),
    archetype: "team",
    adoptionScore: 55,
    rigorScore: 60,
    posture: { id: "ai-native", label: "AI-Native", blurb: "Adopting AI with the rigor to ship it." },
    aiUsage: { detected: true, commitFraction: 0.3, signals: ["Co-Authored-By: Claude"] },
    contributors: [],
    dimensions,
    headline: "acme/api is at L3 — Augmented",
    strengths: ["Solid test suite"],
    risks: ["No secret scanning"],
    roadmap: [],
    discrepancies: [],
    confidence: 0.8,
    scannedAt: "2026-06-10T00:00:00.000Z",
    engine: { provider: "mock", model: "deterministic" },
  };
}

describe("promotedSkillName", () => {
  it("derives a kebab-case slug from the repo (case + punctuation normalized)", () => {
    expect(promotedSkillName("Acme", "Billing.API")).toBe("ascent-onboard-acme-billing-api");
    expect(promotedSkillName("vercel", "next.js")).toBe("ascent-onboard-vercel-next-js");
  });

  it("is stable for the same repo and distinct across repos (the 409 / no-collision contract)", () => {
    expect(promotedSkillName("acme", "api")).toBe(promotedSkillName("acme", "api"));
    expect(promotedSkillName("acme", "api")).not.toBe(promotedSkillName("acme", "web"));
  });
});

describe("buildPromotedSkill", () => {
  it("produces a library entry whose content satisfies the frontmatter contract", () => {
    const skill = buildPromotedSkill(makeReport());
    const fm = parseSkillFrontmatter(skill.content);
    expect(fm.errors).toEqual([]);
    expect(fm.ok).toBe(true);
    expect(fm.data?.name).toBe("ascent-onboard-acme-billing-api");
    expect(fm.data?.category).toBe(PROMOTED_SKILL_CATEGORY);
    expect(fm.data?.description).toBe(skill.description);
  });

  it("replaces the generator's fixed `ascent-onboard` name with the repo-derived one", () => {
    const skill = buildPromotedSkill(makeReport());
    expect(skill.name).toBe("ascent-onboard-acme-billing-api");
    // the old block must not survive anywhere in the promoted document
    expect(skill.content).not.toMatch(/^name: ascent-onboard$/m);
    expect(skill.content.match(/^---$/gm)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the generator's description (it already states when to use the skill)", () => {
    const skill = buildPromotedSkill(makeReport());
    expect(skill.description).toContain("Acme/Billing.API");
    expect(skill.description).toContain("2026-06-10");
    expect(skill.description).not.toContain("\n");
    expect(skill.description.length).toBeLessThanOrEqual(1000);
  });

  it("carries the generated body through (the skill is still the full onboarding harness)", () => {
    const skill = buildPromotedSkill(makeReport());
    const body = parseSkillFrontmatter(skill.content).body;
    expect(body).toContain("# Ascent onboarding — Acme/Billing.API");
    expect(body).toContain("## How to run this skill");
    expect(body).toContain("58/100");
  });

  it("tags the entry for discovery, including the selected track ids, bounded to 20", () => {
    const skill = buildPromotedSkill(makeReport());
    expect(skill.tags.slice(0, 3)).toEqual(["ascent", "onboarding", "acme"]);
    expect(skill.trackIds.length).toBeGreaterThan(0);
    expect(skill.tags).toEqual(expect.arrayContaining(skill.trackIds.slice(0, 5)));
    expect(skill.tags.length).toBeLessThanOrEqual(20);
  });

  it("forwards an explicit track selection to the generator", () => {
    const all = buildPromotedSkill(makeReport());
    const one = buildPromotedSkill(makeReport(), { max: 1 });
    expect(one.trackIds.length).toBe(1);
    expect(all.trackIds.length).toBeGreaterThanOrEqual(one.trackIds.length);
  });

  it("still yields a valid entry for a strong repo with no WEAK tracks", () => {
    const skill = buildPromotedSkill(makeReport({ D1: 95, D2: 95, D3: 95, D4: 95, D5: 95, D6: 95, D7: 95, D8: 95, D9: 95 }, { owner: "acme", name: "api" }, 95));
    // A repo with nothing weak does not get an empty skill: the generator falls back to REFINEMENT
    // targets (buildOnboardingSkill's isRefinement path), so a strong repo is still handed somewhere
    // to go. What matters here is that promotion stays valid whichever path produced the tracks.
    expect(skill.trackIds.length).toBeGreaterThan(0);
    expect(parseSkillFrontmatter(skill.content).ok).toBe(true);
    expect(skill.tags.slice(0, 3)).toEqual(["ascent", "onboarding", "acme"]);
    expect(skill.tags).toEqual(expect.arrayContaining(skill.trackIds.slice(0, 5)));
  });
});
