"use client";

// State/effects for SkillsPanel — the catalog list state, the debounced server refetch, and the
// archive mutation. Extracted per the 200-LOC .tsx cap (docs/ORG-TABS-REFACTOR.md §3): this file owns
// no JSX so SkillsPanel.tsx stays a thin render of what this hook returns.
//
// There is deliberately NO author form here (removed 2026-09-17). A skill enters the library from the
// registry (the org's linked ai-registry checkout, indexed on sync) or from a CLI push; nobody types
// one into the dashboard, so the catalog is a view over what the fleet actually shares, never a
// second place a skill can be born.

import { useEffect, useRef, useState } from "react";
import type { SkillRow, SkillSort } from "@/lib/db";

export function useSkillsLibrary({ slug, initial }: { slug: string; initial: SkillRow[] }) {
  const [skills, setSkills] = useState<SkillRow[]>(initial);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<SkillSort>("recent");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const didMount = useRef(false);

  /** One list read. `signal` belongs to the filter state that asked for it: once superseded, the
   *  request is aborted and neither its rows nor its loading flag may land. */
  async function refresh(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ org: slug, sort });
      if (category) params.set("category", category);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/org/skills?${params.toString()}`, { signal });
      if (signal?.aborted) return;
      if (res.ok) setSkills((await res.json()).skills ?? []);
    } catch {
      /* keep the current list on a transient fetch error (an abort included) */
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  // Re-query the server when a filter changes (debounced so typing doesn't spam). Skips the first run
  // so the server-rendered `initial` isn't immediately refetched.
  //
  // The debounce covers the TIMER; the AbortController covers the request the timer started. Without
  // it a filter changed twice in quick succession left two reads in flight and the SLOWER one won the
  // setState — the list showed rows for a filter the user had already moved off. Mirrors the memory
  // library hook, and the controller+active pattern useRegistryRepoOptions already uses.
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => void refresh(ac.signal), 250);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, sort]);

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
    archive,
  };
}
