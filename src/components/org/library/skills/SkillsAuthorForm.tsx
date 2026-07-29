"use client";

// Extracted from SkillsPanel — the author form (members on a Team+ plan) plus the non-author upsell.
// Pure relocation: same markup, className strings and behavior; form state + `create` live in SkillsPanel
// and are passed in as props. The template-prefill dropdown (Skills P3) moves with the form.

import { SKILL_CATEGORY_LABEL, type SkillCategory } from "@/lib/org/skill-categories";
import { SKILL_TEMPLATES } from "@/lib/org/skill-templates";

export function SkillsAuthorForm({
  canAuthor,
  planAllowed,
  categories,
  name,
  setName,
  formCategory,
  setFormCategory,
  description,
  setDescription,
  content,
  setContent,
  tagsText,
  setTagsText,
  busy,
  create,
  applyTemplate,
}: {
  canAuthor: boolean;
  planAllowed: boolean;
  categories: readonly string[];
  name: string;
  setName: (v: string) => void;
  formCategory: SkillCategory;
  setFormCategory: (v: SkillCategory) => void;
  description: string;
  setDescription: (v: string) => void;
  content: string;
  setContent: (v: string) => void;
  tagsText: string;
  setTagsText: (v: string) => void;
  busy: boolean;
  create: () => void;
  applyTemplate: (idx: number) => void;
}) {
  /* Author form (members on a Team+ plan) — or an upsell when the plan doesn't include the library. */
  if (!canAuthor) {
    return (
      !planAllowed && (
        <p className="mt-5 border-t border-slate-800 pt-4 text-sm text-slate-500">
          Authoring the Skills Library is a <span className="text-slate-300">Team-plan</span> feature. Members can browse, copy and download existing skills.
        </p>
      )
    );
  }

  return (
    <div className="mt-5 space-y-2 border-t border-slate-800 pt-4">
      {/* Skills P3: start from a curated template instead of a blank form. */}
      <label className="flex flex-wrap items-center gap-2 font-mono text-sm text-slate-500">
        Start from a template
        <select
          value=""
          onChange={(e) => e.target.value !== "" && applyTemplate(Number(e.target.value))}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
        >
          <option value="">choose a template…</option>
          {SKILL_TEMPLATES.map((t, i) => (
            <option key={t.name} value={i}>
              {SKILL_CATEGORY_LABEL[t.category]} · {t.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Skill name, e.g. PR review checklist"
          className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
        />
        <select
          value={formCategory}
          onChange={(e) => setFormCategory(e.target.value as SkillCategory)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
        >
          {categories.map((c) => (
            <option key={c} value={c}>{SKILL_CATEGORY_LABEL[c as SkillCategory] ?? c}</option>
          ))}
        </select>
      </div>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What it is / when to use it (optional)"
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Skill body (markdown / SKILL.md) — the reusable prompt or workflow"
        rows={6}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600"
      />
      <input
        value={tagsText}
        onChange={(e) => setTagsText(e.target.value)}
        placeholder="Tags, comma-separated (optional)"
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
      />
      <div className="flex justify-end">
        <button
          onClick={create}
          disabled={busy || !name.trim() || !content.trim()}
          className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add skill"}
        </button>
      </div>
    </div>
  );
}
