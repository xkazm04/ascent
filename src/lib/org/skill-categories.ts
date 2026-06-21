// Single source of truth for Org Skills Library categories (Feature 2, §8.6/§4.5). A small, curated,
// indexed enum — the simplest scalable filter dimension (an indexed `category` column beats a tags
// table for the primary filter). Validated on write (createOrgSkill/updateOrgSkill) and used to drive
// the filter dropdown + the category badge label. Keep this list short and stable; `tags` (JSON) is
// the secondary, open-ended refinement.

export const SKILL_CATEGORIES = [
  "ci-cd",
  "testing",
  "security",
  "ai-native",
  "docs",
  "workflow",
  "other",
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** Human label for a category id (the badge / dropdown text). */
export const SKILL_CATEGORY_LABEL: Record<SkillCategory, string> = {
  "ci-cd": "CI / CD",
  testing: "Testing",
  security: "Security",
  "ai-native": "AI-Native",
  docs: "Docs",
  workflow: "Workflow",
  other: "Other",
};

export function isSkillCategory(v: string | null | undefined): v is SkillCategory {
  return typeof v === "string" && (SKILL_CATEGORIES as readonly string[]).includes(v);
}

/** Coerce arbitrary input to a valid category, defaulting unknown/blank to "other". */
export function normalizeSkillCategory(v: string | null | undefined): SkillCategory {
  return isSkillCategory(v) ? v : "other";
}

/** Label lookup with a safe humanized fallback for an unknown/legacy id (never a blank badge). */
export function skillCategoryLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return (
    SKILL_CATEGORY_LABEL[v as SkillCategory] ??
    v.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
