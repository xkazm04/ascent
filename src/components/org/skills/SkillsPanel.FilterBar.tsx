"use client";

// Extracted from SkillsPanel — the server-filtered controls (search · category · sort). Pure relocation:
// same markup, className strings and aria labels; state stays in SkillsPanel and is passed in as props.

import { SKILL_CATEGORY_LABEL, type SkillCategory } from "@/lib/org/skill-categories";
import type { SkillSort } from "@/lib/db";

const SORTS: { id: SkillSort; label: string }[] = [
  { id: "recent", label: "Recently updated" },
  { id: "downloads", label: "Most used" },
  { id: "name", label: "Name (A–Z)" },
];

export function SkillsFilterBar({
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
    /* Filter bar — server-filtered (search · category · sort). */
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search skills…"
        aria-label="Search skills"
        className="min-w-[10rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        aria-label="Filter by category"
        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {SKILL_CATEGORY_LABEL[c as SkillCategory] ?? c}
          </option>
        ))}
      </select>
      <select
        value={sort}
        onChange={(e) => setSort(e.target.value as SkillSort)}
        aria-label="Sort skills"
        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
      >
        {SORTS.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
    </div>
  );
}
