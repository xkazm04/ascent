// Absence classification and repo stage detection — a VERBATIM port of the registry's own rule
// (`ai-registry/scripts/build-fleet-map.mjs`, `classifyAbsence` + `scopeExcludes`), so ascent's matrix
// and the registry's `librarian/fleet-map.json` classify the same (subject × repo) the same way.
//
// PURE. No database, no network: every input is something the sweep already stored on the repo's
// `RepoConformanceMap` row (`src/lib/db/org-registry-conformance.ts`) or the subject's mirror row.
//
// WHY ABSENCE IS NOT ZERO (`_laws.md#count-carries-predicate`): a subject a repo has no verdict for
// is one of SIX different facts — the repo has no map at all, the subject's bundle is not one the
// repo declares, the repo's scope block excludes it, its owner declined / deferred / accepted it as
// a direction, or nobody has decided anything (a candidate). Rendering all six as an empty cell
// would make the matrix a decoration. First match wins, in the registry's order.

import type { KnowledgeCellState, KnowledgeRepoStage } from "@/lib/org/knowledge-shape";

/** What the classifier needs to know about a subject. `subcategory` widens the brief's signature
 *  because the registry's scope keys include `<bundle>/<category>/<subcategory>` and ascent's own
 *  manifest uses that form — dropping it would misclassify this repo's own scope block. */
export interface AbsenceSubject {
  slug: string;
  bundle: string;
  category: string | null;
  subcategory?: string | null;
}

export type DirectionDecision = "accepted" | "declined" | "deferred";

export interface RepoDirection {
  subject: string;
  bundle: string;
  decision: DirectionDecision;
}

export interface RepoScope {
  outOfScopeCategories: string[];
  outOfScopeSubjects: string[];
}

/** What the classifier needs to know about a repo — the sweep's foundation columns. */
export interface AbsenceRepo {
  hasMap: boolean;
  domains: string[];
  scope: RepoScope;
  directions: RepoDirection[];
}

/**
 * `scopeExcludes` from build-fleet-map.mjs: the scope block lists the subject (`<bundle>/<slug>`),
 * its category (`<bundle>/<category>`) or its subcategory (`<bundle>/<category>/<subcategory>`).
 */
export function scopeExcludes(scope: RepoScope, subject: AbsenceSubject): boolean {
  const subjectKeys = new Set(scope.outOfScopeSubjects);
  const categoryKeys = new Set(scope.outOfScopeCategories);
  if (subjectKeys.has(`${subject.bundle}/${subject.slug}`)) return true;
  if (subject.category && categoryKeys.has(`${subject.bundle}/${subject.category}`)) return true;
  if (subject.category && subject.subcategory && categoryKeys.has(`${subject.bundle}/${subject.category}/${subject.subcategory}`)) {
    return true;
  }
  return false;
}

/**
 * Classify one (subject × repo) ABSENCE — a pair the repo's map does not judge. First match wins:
 *   no-map → out-of-domain → out-of-scope → declined → deferred → accepted → candidate
 *
 * `no-map` is checked FIRST because nothing below it can be known without a map: a repo that was
 * never mapped has no opinion on domains or scope that the matrix should be reading as a verdict.
 * The remaining order is the registry's own (`classifyAbsence`), including the ledger's precedence
 * of declined over deferred over accepted when a subject somehow carries several decisions.
 */
export function classifyAbsence(subject: AbsenceSubject, repo: AbsenceRepo): KnowledgeCellState {
  if (!repo.hasMap) return "no-map";
  if (!repo.domains.includes(subject.bundle)) return "out-of-domain";
  if (scopeExcludes(repo.scope, subject)) return "out-of-scope";
  // The sweep keeps the LATEST decision per subject, so at most one row matches here.
  const row = repo.directions.find((d) => d.subject === subject.slug && d.bundle === subject.bundle);
  if (row?.decision === "declined") return "declined";
  if (row?.decision === "deferred") return "deferred";
  if (row?.decision === "accepted") return "accepted";
  return "candidate";
}

/**
 * Where a repo stands in the registry's pipeline — see `KnowledgeRepoStage`:
 *   populate  no `context-map.json`
 *   map       contexts exist, no `.ai/registry-map.json`
 *   conform   a map with unknown or stale pairs
 *   current   every pair judged against the digest the registry publishes today
 *
 * Order matters: a repo with a map but no context map is still `populate` — the map was generated
 * from a context map that has since gone, and the next honest step is to restore it.
 */
export function repoStage(repo: { hasContextMap: boolean; hasMap: boolean; pairsUnknownOrStale: number }): KnowledgeRepoStage {
  if (!repo.hasContextMap) return "populate";
  if (!repo.hasMap) return "map";
  if (repo.pairsUnknownOrStale > 0) return "conform";
  return "current";
}
