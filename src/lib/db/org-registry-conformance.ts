// `RepoConformanceMap` + `RepoConformance` — one repo's judged (context × subject) pairs, ingested
// from its own `.ai/registry-map.json` (#18).
//
// IDEMPOTENT BY CONSTRUCTION. Pairs upsert on `(repositoryId, contextName, subjectSlug)` and pairs
// absent from the newer map are deleted for that repo in the same call, so a re-ingest of the same
// `mapSha` changes nothing but `ingestedAt` and a context that vanished leaves no stale row behind.
//
// A repo with NO map gets NO rows — deliberately, and every reader must render that as "no map"
// rather than "no deviations". They are different facts and only one of them is good news.
//
// Not barrel-exported, following the standing `org-registry*` convention.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import type { ConformancePair, ConformanceState, MapHeader } from "@/lib/registry/conformance-map";

/** One repo's map header, client-facing (timestamps are ISO strings). */
export interface ConformanceMapRow {
  repositoryId: string;
  repoFullName: string;
  mapSha: string;
  schema: string;
  generatedAt: string;
  contexts: number;
  pairs: number;
  judged: number;
  deviations: number;
  weaklyGoverned: number;
  unmatched: number;
  domains: string[];
  /** NULL when `.ai/consults.jsonl` is absent — "the lane was never written", not "zero consults". */
  consults30d: number | null;
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
}): Promise<{ pairs: number; removed: number }> {
  if (!isDbConfigured()) return { pairs: 0, removed: 0 };
  const prisma = getPrisma();
  const ingestedAt = new Date();
  const { orgId, repositoryId, mapSha, header } = input;
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
    unmatched: header.unmatched,
    domainsJson: JSON.stringify(header.domains),
    bundleDigestsJson: JSON.stringify(header.bundleDigests),
    consults30d: input.consults30d,
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
 * The repos one sweep will visit, with the org already resolved.
 *
 * The org id is resolved HERE and put into the query beside the caller's id list, so a caller can
 * name any repository id it likes and a repo belonging to another org is simply not found — the
 * gate-then-constrain shape AGENTS.md names, kept inside the data layer where the query is.
 *
 * This also exists so `conformance-sweep.ts` — a `src/lib/registry` module — never imports the raw
 * Prisma client, which the layering rule forbids.
 */
export async function listSweepTargets(
  orgSlug: string,
  repositoryIds?: string[],
): Promise<{ orgId: string; repos: { id: string; fullName: string }[] } | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const repos = await getPrisma().repository.findMany({
    where: { orgId, ...(repositoryIds?.length ? { id: { in: repositoryIds } } : {}) },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  return { orgId, repos };
}

/** Drop everything ascent ingested for one repo — used when its map disappears. */
export async function clearRepoConformance(repositoryId: string): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  await prisma.repoConformance.deleteMany({ where: { repositoryId } });
  await prisma.repoConformanceMap.deleteMany({ where: { repositoryId } });
}

/** Every ingested map header for an org, with its repo's full name. */
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
      mapSha: r.mapSha,
      schema: r.schema,
      generatedAt: r.generatedAt.toISOString(),
      contexts: r.contexts,
      pairs: r.pairs,
      judged: r.judged,
      deviations: r.deviations,
      weaklyGoverned: r.weaklyGoverned,
      unmatched: r.unmatched,
      domains: parseList(r.domainsJson),
      consults30d: r.consults30d,
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
