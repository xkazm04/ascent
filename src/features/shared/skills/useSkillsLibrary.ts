"use client";

// State/effects for SkillsPanel — the catalog list state, the debounced server refetch, the author
// form, and the archive/adopt mutations. Extracted per the 200-LOC .tsx cap (docs/ORG-TABS-REFACTOR.md
// §3): this file owns no JSX so SkillsPanel.tsx stays a thin render of what this hook returns.

import { useEffect, useRef, useState } from "react";
import { SKILL_TEMPLATES } from "@/lib/org/skill-templates";
import type { SkillCategory } from "@/lib/org/skill-categories";
import type { SkillRow, SkillSort } from "@/lib/db";

export function useSkillsLibrary({ slug, initial }: { slug: string; initial: SkillRow[] }) {
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

  return {
    skills,
    search,
    setSearch,
    category,
    setCategory,
    sort,
    setSort,
    expanded,
    setExpanded,
    loading,
    error,
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
    archive,
  };
}
