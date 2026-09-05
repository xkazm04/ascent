"use client";

// The tab's selection model: which bundle is open, which subject is focused, and which (repo,
// subjects) pair the dispatch composer is holding. ONE repo at a time — a brief is for one codebase
// (remediation-handoff's one-artifact-per-codebase rule), so picking a cell in a different column
// starts a new selection rather than a cross-repo batch.
//
// Domain and focused subject are DEEP-LINKABLE (`?domain=` / `?subject=`, both in
// `TAB_SCOPED_PARAM_KEYS` so a tab switch clears them). The URL is patched with `router.replace`
// off the React-tracked search string, never `window.location`, for the reason `buildUrl` states.
// The composer's picks are NOT in the URL: a half-composed brief is not a shareable state.

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { KnowledgeView } from "@/lib/org/knowledge-shape";
import { buildUrl } from "@/lib/org/orgTabs";
import { domainOf } from "./knowledgeModel";

export interface KnowledgeSelection {
  domain: string;
  subject: string | null;
  repo: string | null;
  picked: string[];
}

export interface SelectionOptions {
  /** Org slug — required for URL sync. */
  slug?: string;
  initialDomain?: string | null;
  initialSubject?: string | null;
  /** False in the dev preview: a shaped fleet must not write a shareable URL. */
  syncUrl?: boolean;
}

export function useKnowledgeSelection(view: KnowledgeView, opts: SelectionOptions = {}) {
  const router = useRouter();
  const search = useSearchParams();
  const first = domainOf(view, opts.initialDomain ?? null);
  const initialSubject = opts.initialSubject && view.subjects.some((s) => s.slug === opts.initialSubject) ? opts.initialSubject : null;
  const [sel, setSel] = useState<KnowledgeSelection>({ domain: first?.name ?? "", subject: initialSubject, repo: null, picked: [] });

  const sync = useCallback(
    (patch: Record<string, string | null>) => {
      if (!opts.syncUrl || !opts.slug) return;
      router.replace(buildUrl(opts.slug, patch, search.toString()), { scroll: false });
    },
    [opts.slug, opts.syncUrl, router, search],
  );

  const setDomain = useCallback(
    (domain: string) => {
      setSel({ domain, subject: null, repo: null, picked: [] });
      sync({ domain, subject: null });
    },
    [sync],
  );
  const focusSubject = useCallback(
    (subject: string | null) => {
      setSel((s) => ({ ...s, subject }));
      sync({ subject });
    },
    [sync],
  );
  const focusRepo = useCallback((repo: string | null) => setSel((s) => (s.repo === repo ? s : { ...s, repo, picked: [] })), []);

  /** Toggle one (repo, subject) cell into the composer. Switching repo resets the picks. */
  const toggleCell = useCallback((repo: string, subject: string) => {
    setSel((s) => {
      if (s.repo !== repo) return { ...s, repo, picked: [subject] };
      const picked = s.picked.includes(subject) ? s.picked.filter((x) => x !== subject) : [...s.picked, subject];
      return { ...s, picked };
    });
  }, []);

  const clearPicks = useCallback(() => setSel((s) => ({ ...s, picked: [] })), []);

  const domain = useMemo(() => domainOf(view, sel.domain), [view, sel.domain]);
  const repoRow = useMemo(() => view.repos.find((r) => r.repositoryId === sel.repo) ?? null, [view.repos, sel.repo]);
  const subjectRow = useMemo(() => view.subjects.find((s) => s.slug === sel.subject) ?? null, [view.subjects, sel.subject]);

  return { sel, domain, repoRow, subjectRow, setDomain, focusSubject, focusRepo, toggleCell, clearPicks };
}

export type KnowledgeSelectionApi = ReturnType<typeof useKnowledgeSelection>;
