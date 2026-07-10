"use client";

// Org Skills Library (Feature 2) — the browsable catalog: a server-filtered table (search + category +
// sort) over the org's reusable skills, each row expanding to a SkillCard (copy/download/adopt). Authors
// (members on a Team+ plan) get the create form; admins get archive. Mirrors PlaybooksPanel; adds the
// scalable filter bar + the Name·Category·Adoptions·Downloads table. Filtering happens on the server
// (?category=&search=&sort=) so the list stays cheap as the catalog grows.

import { Fragment, useEffect, useRef, useState } from "react";
import { Card, OrgTable, SectionHeader } from "@/components/org/shared/ui";
import { SkillCard } from "@/components/org/skills/SkillCard";
import { SkillsFilterBar } from "@/components/org/skills/SkillsPanel.FilterBar";
import { SkillsAuthorForm } from "@/components/org/skills/SkillsPanel.AuthorForm";
import { skillCategoryLabel, type SkillCategory } from "@/lib/org/skill-categories";
import { SKILL_TEMPLATES } from "@/lib/org/skill-templates";
import type { SkillAdoption, SkillRow, SkillSort } from "@/lib/db";

export function SkillsPanel({
  slug,
  initial,
  categories,
  adoption,
  repoOptions,
  canAuthor,
  isAdmin,
  planAllowed,
}: {
  slug: string;
  initial: SkillRow[];
  categories: readonly string[];
  adoption: Record<string, SkillAdoption>;
  repoOptions: string[];
  canAuthor: boolean;
  isAdmin: boolean;
  planAllowed: boolean;
}) {
  const [skills, setSkills] = useState<SkillRow[]>(initial);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<SkillSort>("recent");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // author form
  const [name, setName] = useState("");
  const [formCategory, setFormCategory] = useState<SkillCategory>("workflow");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [busy, setBusy] = useState(false);

  const didMount = useRef(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ org: slug, sort });
      if (category) params.set("category", category);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/org/skills?${params.toString()}`);
      if (res.ok) setSkills((await res.json()).skills ?? []);
    } catch {
      /* keep the current list on a transient fetch error */
    } finally {
      setLoading(false);
    }
  }

  // Re-query the server when a filter changes (debounced so typing doesn't spam). Skips the first run
  // so the server-rendered `initial` isn't immediately refetched.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, sort]);

  async function create() {
    if (!name.trim() || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const tags = tagsText.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
      const res = await fetch("/api/org/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org: slug,
          name: name.trim(),
          category: formCategory,
          description: description.trim() || undefined,
          content,
          tags,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed.");
      setName("");
      setDescription("");
      setContent("");
      setTagsText("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  // Skills P3: prefill the author form from a curated starter template (the org edits before saving).
  function applyTemplate(idx: number) {
    const t = SKILL_TEMPLATES[idx];
    if (!t) return;
    setName(t.name);
    setFormCategory(t.category);
    setDescription(t.description);
    setContent(t.content);
    setTagsText(t.tags.join(", "));
  }

  async function archive(id: string) {
    // DELETE is admin-gated; the control only renders for admins, but still check res.ok + roll back
    // so a failure can't make a skill vanish from the UI while it survives in the DB.
    const prev = skills;
    setError(null);
    setSkills((s) => s.filter((x) => x.id !== id));
    const res = await fetch(`/api/org/skills/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      setSkills(prev);
      setError((await res?.json().catch(() => ({})))?.error ?? "Couldn't archive the skill (admins only).");
    }
  }

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Skills Library"
        description="Your org's reusable Claude/LLM skills — author once, the whole team discovers and reuses them. Copy a skill into Claude Code, or download it as a SKILL.md."
      />

      <SkillsFilterBar
        search={search}
        setSearch={setSearch}
        category={category}
        setCategory={setCategory}
        sort={sort}
        setSort={setSort}
        categories={categories}
      />

      <div className="mt-4">
        {skills.length === 0 ? (
          <p className="text-base text-slate-500">
            {loading ? "Loading…" : search || category ? "No skills match your filters." : "No skills yet — author your org's first reusable skill below."}
          </p>
        ) : (
          <OrgTable
            caption="Org skills: name, category, adoptions and downloads"
            minWidth={560}
            head={
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-right">Adoptions</th>
                <th className="px-3 py-2 text-right">Uses</th>
              </tr>
            }
          >
            {skills.map((s) => {
              const open = expanded === s.id;
              return (
                <Fragment key={s.id}>
                  <tr
                    onClick={() => setExpanded(open ? null : s.id)}
                    className="cursor-pointer"
                  >
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-200">{s.name}</span>
                      {s.version > 1 && <span className="ml-2 font-mono text-xs text-slate-500">v{s.version}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs text-slate-400">
                        {skillCategoryLabel(s.category)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{s.adoptionCount}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-400">{s.downloadCount}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={4} className="px-3 pb-3">
                        <SkillCard
                          skill={s}
                          slug={slug}
                          adoption={adoption[s.id]}
                          repoOptions={repoOptions}
                          canArchive={isAdmin}
                          onArchive={() => archive(s.id)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </OrgTable>
        )}
      </div>

      <SkillsAuthorForm
        canAuthor={canAuthor}
        planAllowed={planAllowed}
        categories={categories}
        name={name}
        setName={setName}
        formCategory={formCategory}
        setFormCategory={setFormCategory}
        description={description}
        setDescription={setDescription}
        content={content}
        setContent={setContent}
        tagsText={tagsText}
        setTagsText={setTagsText}
        busy={busy}
        create={create}
        applyTemplate={applyTemplate}
      />
      {error && <p className="mt-2 text-sm text-orange-300">{error}</p>}
    </Card>
  );
}
