// Skills P3 — the curated starter templates must stay valid against the library's own rules: a real
// category, a non-empty name + body, and within the create bounds (so a one-click "use template" can't
// produce a skill the API would reject).

import { describe, it, expect } from "vitest";
import { SKILL_TEMPLATES } from "@/lib/org/skill-templates";
import { isSkillCategory } from "@/lib/org/skill-categories";

describe("SKILL_TEMPLATES", () => {
  it("has a few curated templates", () => {
    expect(SKILL_TEMPLATES.length).toBeGreaterThanOrEqual(4);
  });

  it("every template is valid + within the create bounds", () => {
    for (const t of SKILL_TEMPLATES) {
      expect(isSkillCategory(t.category)).toBe(true);
      expect(t.name.trim().length).toBeGreaterThan(0);
      expect(t.name.length).toBeLessThanOrEqual(200);
      expect(t.description.length).toBeLessThanOrEqual(1000);
      expect(t.content.trim().length).toBeGreaterThan(0);
      expect(t.content.length).toBeLessThanOrEqual(50_000);
      expect(Array.isArray(t.tags)).toBe(true);
      expect(t.tags.length).toBeLessThanOrEqual(20);
    }
  });

  it("template names are unique (stable dropdown keys)", () => {
    const names = SKILL_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
