// The client-safe SHAPE of the Knowledge base view: its types and the pure helpers that read them.
// Split out of `knowledge-view.ts` because that module reaches the database (via `registry-view` →
// `@/lib/db` → Prisma → `pg`) and the tab's tree / matrix / dispatch composer render under
// `"use client"`. A single VALUE import from there pulls the whole Prisma/pg chain into the browser
// bundle, which fails to resolve Node's `tls` and `util/types` and 500s every /org/<slug> route.
// Types alone would be erased; a value import is what crosses the boundary, so the values live here.
//
// Rule of thumb for this pair: anything a client component needs goes in this file; anything that
// touches the database stays in `knowledge-view.ts`.
//
// ## What the view mirrors
//
// The registry's knowledge lane, AS THE REGISTRY STRUCTURES IT: bundle (domain) → category →
// subcategory → subject, from each bundle's own generated `index.json` + `taxonomy.json`. Ascent reads
// and never recomputes — every count here is the bundle's own. Techniques are counted, not listed:
// the indexer mirrors subjects, and subject is the finest grain the tab renders.
//
// On top of the structure sits how the FLEET stands against it: one cell per (subject × repo), whose
// state is either a verdict the repo's own `/conform` wrote into its `.ai/registry-map.json` (and the
// sweep ingested), or an ABSENCE classified the way the registry's `build-fleet-map.mjs` classifies
// it. Absence is never zero: "no map", "out of domain", "declined" and "candidate" are four different
// facts that would all render as an empty cell otherwise (`_laws.md#count-carries-predicate`).

import type { SignalSummary } from "@/lib/registry/signals";

export type { SignalSummary };

export type KnowledgeStatus = "unmapped" | "empty" | "indexed" | "error";

/** A subcategory of a bundle's taxonomy — the second level under `knowledge/<domain>/<category>/`. */
export type KnowledgeSubcategory = {
  id: string;
  title: string;
  /** Subject slugs in the taxonomy's declared order. */
  subjects: string[];
};

/** One category of a bundle's `taxonomy.json`, in declaration order. */
export type KnowledgeCategory = {
  id: string;
  title: string;
  order: number;
  /** Subjects that sit directly under the category (no subcategory). */
  subjects: string[];
  subcategories: KnowledgeSubcategory[];
};

/** One domain bundle's overview row. Mirrors `index.json`'s `meta` block plus its taxonomy. */
export type KnowledgeDomain = {
  /** Directory name under `knowledge/`, e.g. `software-engineering`. */
  name: string;
  /** Display title derived from the name. */
  title: string;
  subjects: number;
  techniques: number;
  applications: number;
  /** Cross-cutting laws cited by this bundle's techniques. */
  laws: number;
  /** Category ids declared by the bundle, in declaration order. */
  categories: string[];
  /**
   * How many techniques carry a `use_when` trigger, as `written/total`. This is the field an agent
   * selects on, so a low ratio is the difference between a bundle that can be consulted
   * automatically and one that can only be read by a human.
   */
  useWhenCoverage: { written: number; total: number };
  /**
   * The bundle's `taxonomy.json`, mirrored by the indexer. EMPTY when the index pass predates the
   * mirror — the tree then falls back to grouping subjects by their own `category` / `subcategory`
   * ids with derived titles, which is the same shape with worse labels, never a different one.
   */
  taxonomy: KnowledgeCategory[];
};

/** One subject (golden path) as the bundle's index states it — `OrgKnowledgeSubject`, client-safe. */
export type KnowledgeSubject = {
  bundle: string;
  slug: string;
  category: string | null;
  subcategory: string | null;
  /** `draft | forged | reconciled | transplant-tested`, or null when the index carried none. */
  status: string | null;
  /** Repo-relative path of the golden path, VERBATIM from the index — never built from the slug. */
  file: string;
  techniqueCount: number;
  /** Every technique's `use_when` triggers, flattened. What `/consult` and the MCP tool match on. */
  useWhen: string[];
  laws: string[];
  /** The subject's content digest from the index; null when the index pass predates the mirror. */
  digest: string | null;
};

/**
 * Where a repo stands in the registry's own pipeline, derived by the sweep:
 *   populate  — no `context-map.json`: the repo has never been scanned for contexts
 *   map       — contexts exist, no `.ai/registry-map.json`: the join has not been built
 *   conform   — a map with unknown or stale pairs: verdicts are owed
 *   current   — every pair judged against the subject digest the registry publishes today
 */
export type KnowledgeRepoStage = "populate" | "map" | "conform" | "current";

/** One fleet repo as the last sweep saw it. One row per SWEPT repo, mapped or not. */
export type KnowledgeRepo = {
  repositoryId: string;
  fullName: string;
  stage: KnowledgeRepoStage;
  hasMap: boolean;
  hasContextMap: boolean;
  hasManifest: boolean;
  /** `knowledge.domains` from the repo's manifest; [] when there is no manifest. */
  domains: string[];
  /** The manifest's `scope` block, as the fleet map reads it. Empty lists when absent. */
  scope: { outOfScopeCategories: string[]; outOfScopeSubjects: string[] };
  /** Decisions from `.ai/directions/ledger.jsonl`, latest per subject. */
  directions: { subject: string; bundle: string; decision: "accepted" | "declined" | "deferred" }[];
  contexts: number;
  pairs: number;
  judged: number;
  deviations: number;
  /** Weakly-governed contexts BY NAME — the map states them; a count names nothing actionable. */
  weaklyGoverned: string[];
  /** ISO time of the sweep that produced this row; null only for a fixture row that was never swept. */
  sweptAt: string | null;
};

/**
 * The closed vocabulary of a matrix cell. The first four are the repo's OWN verdicts (`/conform`
 * wrote them; `unknown` is the matcher's unjudged pair). The rest are absences, classified in the
 * order `build-fleet-map.mjs` classifies them — first match wins:
 *   out-of-domain  the repo's manifest does not declare the subject's bundle
 *   out-of-scope   the manifest's scope block excludes the subject or its category
 *   declined / deferred / accepted   a direction decision in the repo's ledger
 *   candidate      in domain, in scope, no decision, no context resonates — the direction backlog
 *   no-map         the repo has no `.ai/registry-map.json` at all (nothing above can be known)
 */
export const KNOWLEDGE_CELL_STATES = [
  "conformant",
  "deviation",
  "not-applicable",
  "unknown",
  "candidate",
  "accepted",
  "deferred",
  "declined",
  "out-of-scope",
  "out-of-domain",
  "no-map",
] as const;

export type KnowledgeCellState = (typeof KNOWLEDGE_CELL_STATES)[number];

/** One (subject × repo) cell. Judged pairs are folded worst-wins across the repo's contexts. */
export type KnowledgeCell = {
  subject: string;
  repositoryId: string;
  state: KnowledgeCellState;
  /** A judged pair whose `evaluatedAgainst` is not the subject's current digest — verdict predates the standard. */
  stale: boolean;
  /** How many of the repo's contexts this subject governs (0 for an absence). */
  contexts: number;
  /** `file:line` evidence exactly as the map stated it, for the worst pair; null for absences. */
  evidence: string | null;
};

export type RegistryDispatchStage = "populate" | "map" | "conform";
export type RegistryDispatchMode = "brief" | "local";
/**
 *   handed_off  a brief was composed and given to the operator (nothing is running)
 *   running     the local agent is in the worktree
 *   proposed    the local agent pushed a branch and opened a PR; waiting on merge + sweep
 *   done        the sweep saw the map move (and, for conform, the named subjects judged)
 *   failed      the local run errored; `error` says how
 *   superseded  a newer dispatch for the same repo + stage replaced this one
 */
export type RegistryDispatchStatus = "handed_off" | "running" | "proposed" | "done" | "failed" | "superseded";

/** One hand-off, client-facing. Timestamps are ISO strings (wire-safe). */
export type RegistryDispatchRow = {
  id: string;
  repositoryId: string;
  repoFullName: string;
  stage: RegistryDispatchStage;
  mode: RegistryDispatchMode;
  status: RegistryDispatchStatus;
  /** Subject slugs the brief names verbatim; [] for populate / map. */
  subjects: string[];
  briefDigest: string;
  actor: string;
  branch: string | null;
  prUrl: string | null;
  mapShaBefore: string | null;
  mapShaAfter: string | null;
  model: string | null;
  costMicros: number | null;
  turns: number | null;
  agentDurationMs: number | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};

export type KnowledgeView = {
  status: KnowledgeStatus;
  /** The mapped registry repo, when there is one. */
  registry?: { fullName: string; url: string; lastIndexedAt: string | null };
  /** Sorted by artifact weight, largest first — see `sortDomains`. */
  domains: KnowledgeDomain[];
  totals: { domains: number; subjects: number; techniques: number; applications: number };
  /** Every live subject across every bundle, bundle then slug. */
  subjects: KnowledgeSubject[];
  /** Every repo the last sweep visited. Columns of the matrix are `repos.filter(r => r.hasMap)`. */
  repos: KnowledgeRepo[];
  /** One entry per (subject × swept repo). Sparse is not allowed: an absent pair IS a classified cell. */
  cells: KnowledgeCell[];
  /** The `signals/` lane per subject. An empty list is "no witness", never "no demand". */
  signals: SignalSummary[];
  /** Newest first. */
  dispatches: RegistryDispatchRow[];
  sweep: {
    /** ISO time of the last sweep; null = never swept, which every surface renders loudly. */
    lastAt: string | null;
    warnings: string[];
    /** The pair cap bit: the matrix is partial and says so. */
    truncated: boolean;
  };
  /** What THIS viewer may do — render an action only when its flag is true. */
  capabilities: { canSweep: boolean; canBrief: boolean; canRunLocal: boolean };
  error?: { message: string; at: string };
};

/** Total published artifacts across the three layers that publish. */
export function artifactTotal(d: KnowledgeDomain): number {
  return d.subjects + d.techniques + d.applications;
}

/**
 * Sort order for the ledger: heaviest bundle first, ties broken by name so the order is stable
 * across renders (two bundles of equal weight must not swap places between page loads).
 */
export function sortDomains(domains: KnowledgeDomain[]): KnowledgeDomain[] {
  return [...domains].sort((a, b) => artifactTotal(b) - artifactTotal(a) || a.name.localeCompare(b.name));
}

/** `software-engineering` → `Software engineering`. Presentation derived from identity, never stored twice. */
export function titleOfSlug(slug: string): string {
  const spaced = slug.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
