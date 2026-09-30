"use client";

// Same server filters as the Altimeter bar: search, category, sort. Each control keeps its
// accessible name. Ids are filter-scoped so they do not collide with the token form.
import { FormField, Input, Select } from "@/components/kit";
import { SKILL_CATEGORY_LABEL, type SkillCategory } from "@/lib/org/skill-categories";
import type { SkillSort } from "@/lib/db";

const SORTS: { id: SkillSort; label: string }[] = [
  { id: "recent", label: "Recently updated" },
  { id: "downloads", label: "Most used" },
  { id: "name", label: "Name (A–Z)" },
];

export function SkillsFilterV2({
  search,
  setSearch,
  category,
  setCategory,
  sort,
  setSort,
  categories,
}: {
  search: string;
  setSearch: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  sort: SkillSort;
  setSort: (v: SkillSort) => void;
  categories: readonly string[];
}) {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <FormField label="Search" htmlFor="skill-filter-search">
        <Input
          id="skill-filter-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills…"
          aria-label="Search skills"
        />
      </FormField>
      <FormField label="Category" htmlFor="skill-filter-category">
        <Select
          id="skill-filter-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {SKILL_CATEGORY_LABEL[c as SkillCategory] ?? c}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Sort" htmlFor="skill-filter-sort">
        <Select id="skill-filter-sort" value={sort} onChange={(e) => setSort(e.target.value as SkillSort)} aria-label="Sort skills">
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}
