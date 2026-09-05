"use client";

// The one selection model every variant shares: which bundle is open, which subject is focused,
// and which (repo, subjects) pair the dispatch composer is holding. ONE repo at a time — a brief is
// for one codebase (remediation-handoff's one-artifact-per-codebase rule), so picking a cell in a
// different column starts a new selection rather than a cross-repo batch.

import { useCallback, useMemo, useState } from "react";
import type { KnowledgeView } from "@/lib/org/knowledge-shape";
import { domainOf } from "./knowledgeModel";

export interface KnowledgeSelection {
  domain: string;
  subject: string | null;
  repo: string | null;
  picked: string[];
}

export function useKnowledgeSelection(view: KnowledgeView, initialDomain?: string | null) {
  const first = domainOf(view, initialDomain ?? null);
  const [sel, setSel] = useState<KnowledgeSelection>({ domain: first?.name ?? "", subject: null, repo: null, picked: [] });

  const setDomain = useCallback((domain: string) => setSel({ domain, subject: null, repo: null, picked: [] }), []);
  const focusSubject = useCallback((subject: string | null) => setSel((s) => ({ ...s, subject })), []);
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
