// `RepoConformanceMap` + `RepoConformance` — one repo's judged (context × subject) pairs, ingested
// from its own `.ai/registry-map.json` (#18), and — since the knowledge-base rebuild — the repo's
// FOUNDATION facts beside them (context map present? manifest? which domains, scope, decisions?).
//
// IDEMPOTENT BY CONSTRUCTION. Pairs upsert on `(repositoryId, contextName, subjectSlug)` and pairs
// absent from the newer map are deleted for that repo in the same call, so a re-ingest of the same
// `mapSha` changes nothing but `ingestedAt` and a context that vanished leaves no stale row behind.
//
// ONE HEADER ROW PER SWEPT REPO, mapped or not. A repo with NO map gets a header row with
// `mapSha: null` and no pairs — deliberately, so a reader can tell "swept, no map" from "never
// swept" (no row) and from "swept and judged". Every reader must render `mapSha === null` as "no
// map" rather than "no deviations"; they are different facts and only one of them is good news.
//
// Not barrel-exported, following the standing `org-registry*` convention.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import type { ConformancePair, ConformanceState, MapHeader } from "@/lib/registry/conformance-map";
import type { RepoDirection, RepoScope } from "@/lib/registry/absence";

/** What the sweep learned from a repo's foundation files, stored beside its map header. */
export interface RepoFoundation {
  hasContextMap: boolean;
  hasManifest: boolean;
  /** `knowledge.domains` from the manifest; [] without one. */
  domains: string[];
  scope: RepoScope;
  directions: RepoDirection[];
}

export const EMPTY_FOUNDATION: RepoFoundation = {
  hasContextMap: false,
  hasManifest: false,
  domains: [],
  scope: { outOfScopeCategories: [], outOfScopeSubjects: [] },
  directions: [],
};

/** One swept repo's header, client-facing (timestamps are ISO strings). */
export interface ConformanceMapRow {
  repositoryId: string;
  repoFullName: string;
  /** NULL = the sweep found no `.ai/registry-map.json`. `hasMap` is exactly `mapSha !== null`. */
  mapSha: string | null;
  schema: string;
  /** The map's own `generatedAt`; for a map-less repo, the sweep time. */
  generatedAt: string;
  contexts: number;
  pairs: number;
  judged: number;
  deviations: number;
  weaklyGoverned: number;
  /** The weakly-governed contexts BY NAME, as the map states them. */
  weaklyGovernedContexts: string[];
  unmatched: number;
  /** The manifest's `knowledge.domains` when it has one, else the map's own `domains`. */
  domains: string[];
  /** NULL when `.ai/consults.jsonl` is absent — "the lane was never written", not "zero consults". */
  consults30d: number | null;
  hasContextMap: boolean;
  hasManifest: boolean;
  scope: RepoScope;
  directions: RepoDirection[];
  warnings: string[];
  ingestedAt: string;
}

/** One judged pair, client-facing. */
export interface ConformanceRow {
  repositoryId: string;
  repoFullName: string;
  contextName: string;
  contextGroup: string | null;
  bundle: string;
  subjectSlug: string;
  state: ConformanceState;
  confidence: string | null;
  score: number | null;
  evidence: string | null;
  evaluatedAt: string | null;
  evaluatedAgainst: string | null;
  mapSha: string;
  ingestedAt: string;
}

const parseList = (raw: string): string[] => {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const parseScope = (raw: string): RepoScope => {
  try {
    const v = JSON.parse(raw) as { outOfScopeCategories?: unknown; outOfScopeSubjects?: unknown } | null;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
    return { outOfScopeCategories: list(v?.outOfScopeCategories), outOfScopeSubjects: list(v?.outOfScopeSubjects) };
  } catch {
    return { outOfScopeCategories: [], outOfScopeSubjects: [] };
  }
};

const parseDirections = (raw: string): RepoDirection[] => {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (d): d is RepoDirection =>
        Boolean(d) &&
        typeof d === "object" &&
        typeof (d as RepoDirection).subject === "string" &&
        typeof (d as RepoDirection).bundle === "string" &&
        ["accepted", "declined", "deferred"].includes((d as RepoDirection).decision),
    );
  } catch {
    return [];
  }
};

/** The foundation columns, serialized once for both writers. */
const foundationData = (f: RepoFoundation) => ({
  hasContextMap: f.hasContextMap,
  hasManifest: f.hasManifest,
  scopeJson: JSON.stringify(f.scope),
  directionsJson: JSON.stringify(f.directions),
});

/**
 * Ingest one repo's map. Returns what changed.
 *
 * ORDER, stated because it is a deliberate trade-off rather than an oversight: the stale pairs are
 * deleted first, then the current ones upserted, and this is NOT one transaction. A map can carry
 * hundreds of pairs and holding a write transaction open across that many round trips would be the
 * more likely failure. The window a concurrent reader can land in therefore shows a repo with FEWER
 * pairs than it has — never a pair it no longer claims, and never a verdict it never wrote, which
 * are the two errors that would actually mislead. The header lands last, so its counts are the
 * completion signal.
 */
export async function ingestRepoConformance(input: {
  orgId: string;
  repositoryId: string;
  mapSha: string;
  header: MapHeader;
  pairs: ConformancePair[];
  consults30d: number | null;
  warnings: string[];
  foundation?: RepoFoundation;
}): Promise<{ pairs: number; removed: number }> {
  if (!isDbConfigured()) return { pairs: 0, removed: 0 };
  const prisma = getPrisma();
  const ingestedAt = new Date();
  const { orgId, repositoryId, mapSha, header } = input;
  const foundation = input.foundation ?? EMPTY_FOUNDATION;
  const generatedAt = Number.isFinite(Date.parse(header.generatedAt)) ? new Date(header.generatedAt) : ingestedAt;

  const keys = input.pairs.map((p) => ({ contextName: p.contextName, subjectSlug: p.subjectSlug }));
  const removed = await prisma.repoConformance.deleteMany({
    where: {
      repositoryId,
      ...(keys.length ? { NOT: { OR: keys.map((k) => ({ contextName: k.contextName, subjectSlug: k.subjectSlug })) } } : {}),
    },
  });

  for (const p of input.pairs) {
    const data = {
      contextGroup: p.contextGroup,
      bundle: p.bundle,
      state: p.state,
      confidence: p.confidence,
      score: p.score,
      evidence: p.evidence,
      evaluatedAt: p.evaluatedAt && Number.isFinite(Date.parse(p.evaluatedAt)) ? new Date(p.evaluatedAt) : null,
      evaluatedAgainst: p.evaluatedAgainst,
      mapSha,
      ingestedAt,
    };
    await prisma.repoConformance
      .upsert({
        where: {
          repositoryId_contextName_subjectSlug: {
            repositoryId,
            contextName: p.contextName,
            subjectSlug: p.subjectSlug,
          },
        },
        update: data,
        create: { orgId, repositoryId, contextName: p.contextName, subjectSlug: p.subjectSlug, ...data },
      })
      .catch(() => {});
  }

  const headerData = {
    mapSha,
    schema: header.schema,
    generatedAt,
    contexts: header.contexts,
    pairs: header.pairs,
    judged: header.judged,
    deviations: header.deviations,
    weaklyGoverned: header.weaklyGoverned,
    weaklyGovernedJson: JSON.stringify(header.weaklyGovernedContexts.slice(0, 500)),
    unmatched: header.unmatched,
    // The manifest is the declaration; the map's `domains` was generated from it. Prefer the
    // declaration when the repo has one, so a repo whose manifest moved on reads as it reads today.
    domainsJson: JSON.stringify(foundation.hasManifest ? foundation.domains : header.domains),
    bundleDigestsJson: JSON.stringify(header.bundleDigests),
    consults30d: input.consults30d,
    ...foundationData(foundation),
    warningsJson: JSON.stringify(input.warnings.slice(0, 50)),
    ingestedAt,
  };
  await prisma.repoConformanceMap.upsert({
    where: { repositoryId },
    update: headerData,
    create: { orgId, repositoryId, ...headerData },
  });
  return { pairs: input.pairs.length, removed: removed.count };
}

/**
 * The repos one sweep will visit, with the org already resolved. `org` is the slug (every route
 * has one) or `{ orgId }` (the indexer, which holds the registry row's org id and no slug).
 *
 * The org id is resolved HERE and put into the query beside the caller's id list, so a caller can
 * name any repository id it likes and a repo belonging to another org is simply not found — the
 * gate-then-constrain shape AGENTS.md names, kept inside the data layer where the query is.
 *
 * This also exists so `conformance-sweep.ts` — a `src/lib/registry` module — never imports the raw
 * Prisma client, which the layering rule forbids.
 */
export async function listSweepTargets(
  org: string | { orgId: string },
  repositoryIds?: string[],
): Promise<{ orgId: string; repos: { id: string; fullName: string }[] } | null> {
  if (!isDbConfigured()) return null;
  const orgId = typeof org === "string" ? await getOrgId(org) : org.orgId;
  if (!orgId) return null;
  const repos = await getPrisma().repository.findMany({
    where: { orgId, ...(repositoryIds?.length ? { id: { in: repositoryIds } } : {}) },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  return { orgId, repos };
}

/**
 * Record a swept repo that has NO map: its pairs are dropped (it no longer claims those verdicts)
 * and its header row is kept — `mapSha` null, counts zero, `schema` "", `generatedAt` the sweep
 * time — carrying the foundation facts the absence classifier needs. Nothing else in the fleet can
 * say "swept and found nothing", which is a different fact from "never swept".
 */
export async function clearRepoConformance(input: {
  orgId: string;
  repositoryId: string;
  foundation: RepoFoundation;
  warnings?: string[];
  now?: Date;
}): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const { orgId, repositoryId, foundation } = input;
  const ingestedAt = input.now ?? new Date();
  await prisma.repoConformance.deleteMany({ where: { repositoryId } });
  const headerData = {
    mapSha: null,
    schema: "",
    generatedAt: ingestedAt,
    contexts: 0,
    pairs: 0,
    judged: 0,
    deviations: 0,
    weaklyGoverned: 0,
    weaklyGovernedJson: "[]",
    unmatched: 0,
    domainsJson: JSON.stringify(foundation.domains),
    bundleDigestsJson: "{}",
    consults30d: null,
    ...foundationData(foundation),
    warningsJson: JSON.stringify((input.warnings ?? []).slice(0, 50)),
    ingestedAt,
  };
  await prisma.repoConformanceMap.upsert({
    where: { repositoryId },
    update: headerData,
    create: { orgId, repositoryId, ...headerData },
  });
}

/** Every swept repo's header for an org (mapped or not), with its repo's full name. */
export async function listConformanceMaps(orgId: string): Promise<ConformanceMapRow[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const rows = await prisma.repoConformanceMap.findMany({ where: { orgId } });
  const names = await repoNames(
    prisma,
    rows.map((r) => r.repositoryId),
  );
  return rows
    .map((r) => ({
      repositoryId: r.repositoryId,
      repoFullName: names.get(r.repositoryId) ?? r.repositoryId,
      mapSha: r.mapSha ?? null,
      schema: r.schema,
      generatedAt: r.generatedAt.toISOString(),
      contexts: r.contexts,
      pairs: r.pairs,
      judged: r.judged,
      deviations: r.deviations,
      weaklyGoverned: r.weaklyGoverned,
      weaklyGovernedContexts: parseList(r.weaklyGovernedJson),
      unmatched: r.unmatched,
      domains: parseList(r.domainsJson),
      consults30d: r.consults30d,
      hasContextMap: Boolean(r.hasContextMap),
      hasManifest: Boolean(r.hasManifest),
      scope: parseScope(r.scopeJson),
      directions: parseDirections(r.directionsJson),
      warnings: parseList(r.warningsJson),
      ingestedAt: r.ingestedAt.toISOString(),
    }))
    .sort((a, b) => a.repoFullName.localeCompare(b.repoFullName));
}

/**
 * Judged pairs for an org. `states` narrows to a subset (the matrix asks for all; a deviation
 * backlog asks for one).
 */
export async function listConformance(
  orgId: string,
  opts: { states?: ConformanceState[]; subjectSlug?: string; repositoryId?: string; limit?: number } = {},
): Promise<ConformanceRow[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const rows = await prisma.repoConformance.findMany({
    where: {
      orgId,
      ...(opts.states?.length ? { state: { in: opts.states } } : {}),
      ...(opts.subjectSlug ? { subjectSlug: opts.subjectSlug } : {}),
      ...(opts.repositoryId ? { repositoryId: opts.repositoryId } : {}),
    },
    orderBy: [{ subjectSlug: "asc" }, { contextName: "asc" }],
    take: Math.min(5000, Math.max(1, opts.limit ?? 5000)),
  });
  const names = await repoNames(
    prisma,
    rows.map((r) => r.repositoryId),
  );
  return rows.map((r) => ({
    repositoryId: r.repositoryId,
    repoFullName: names.get(r.repositoryId) ?? r.repositoryId,
    contextName: r.contextName,
    contextGroup: r.contextGroup,
    bundle: r.bundle,
    subjectSlug: r.subjectSlug,
    state: r.state as ConformanceState,
    confidence: r.confidence,
    score: r.score,
    evidence: r.evidence,
    evaluatedAt: r.evaluatedAt ? r.evaluatedAt.toISOString() : null,
    evaluatedAgainst: r.evaluatedAgainst,
    mapSha: r.mapSha,
    ingestedAt: r.ingestedAt.toISOString(),
  }));
}

/**
 * Which subjects govern a named context, across the fleet — the read W2-K's
 * `get_governing_subject` tool is built on. Returned in the order the maps' own matcher ranked them
 * (highest score first), with the strongest state seen for each.
 */
export async function listSubjectsForContext(
  orgId: string,
  contextName: string,
): Promise<{ bundle: string; subjectSlug: string; state: ConformanceState; score: number | null; repos: number }[]> {
  if (!isDbConfigured()) return [];
  const rows = await getPrisma().repoConformance.findMany({ where: { orgId, contextName } });
  const by = new Map<string, { bundle: string; subjectSlug: string; state: ConformanceState; score: number | null; repos: number }>();
  for (const r of rows) {
    const key = `${r.bundle} ${r.subjectSlug}`;
    const prev = by.get(key);
    const state = r.state as ConformanceState;
    if (!prev) {
      by.set(key, { bundle: r.bundle, subjectSlug: r.subjectSlug, state, score: r.score, repos: 1 });
      continue;
    }
    prev.repos += 1;
    if (r.score !== null && (prev.score === null || r.score > prev.score)) prev.score = r.score;
    // A deviation anywhere in the fleet is the fact worth surfacing; `unjudged` only ever loses.
    if (state === "deviation" || (prev.state === "unjudged" && state !== "unjudged")) prev.state = state;
  }
  return Array.from(by.values()).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

async function repoNames(
  prisma: ReturnType<typeof getPrisma>,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return new Map();
  const repos = await prisma.repository.findMany({
    where: { id: { in: unique } },
    select: { id: true, fullName: true },
  });
  return new Map(repos.map((r) => [r.id, r.fullName]));
}
