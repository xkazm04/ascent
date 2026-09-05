// Pure tests for the Org Skills Library category enum (Feature 2): validation, normalization, and the
// label fallback that keeps a badge from ever rendering blank for an unknown/legacy id.

import { describe, it, expect } from "vitest";
import {
  SKILL_CATEGORIES,
  isSkillCategory,
  normalizeSkillCategory,
  skillCategoryLabel,
} from "@/lib/org/skill-categories";

describe("isSkillCategory", () => {
  it("accepts every declared category", () => {
    for (const c of SKILL_CATEGORIES) expect(isSkillCategory(c)).toBe(true);
  });
  it("rejects unknown / blank / nullish", () => {
    expect(isSkillCategory("nope")).toBe(false);
    expect(isSkillCategory("")).toBe(false);
    expect(isSkillCategory(null)).toBe(false);
    expect(isSkillCategory(undefined)).toBe(false);
  });
});

describe("normalizeSkillCategory", () => {
  it("passes a valid category through", () => {
    expect(normalizeSkillCategory("security")).toBe("security");
  });
  it("defaults unknown/blank to 'other'", () => {
    expect(normalizeSkillCategory("garbage")).toBe("other");
    expect(normalizeSkillCategory("")).toBe("other");
    expect(normalizeSkillCategory(undefined)).toBe("other");
  });
});

describe("skillCategoryLabel", () => {
  it("uses the curated label for a known id", () => {
    expect(skillCategoryLabel("ci-cd")).toBe("CI / CD");
    expect(skillCategoryLabel("ai-native")).toBe("AI-Native");
  });
  it("humanizes an unknown id instead of rendering blank", () => {
    expect(skillCategoryLabel("data-pipeline")).toBe("Data Pipeline");
  });
  it("renders an em dash for nullish", () => {
    expect(skillCategoryLabel(null)).toBe("—");
    expect(skillCategoryLabel(undefined)).toBe("—");
  });
});
