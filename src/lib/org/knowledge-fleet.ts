// The PURE half of the Knowledge base loader: subjects + swept repos + judged pairs → the contract's
// `repos` and DENSE `cells` (`src/lib/org/knowledge-shape.ts`). No database, so it is testable from
// three arrays, and `knowledge-view.ts` stays the thin loader that fetches them.
//
// DENSE IS THE POINT. One cell per (subject × swept repo), no exceptions: a pair the repo's map
// judged is folded worst-wins (`conformance-fold.ts`); a pair it does not carry is CLASSIFIED
// (`absence.ts`) — no map, out of domain, out of scope, declined, deferred, accepted, candidate.
// A sparse matrix would render all seven of those as the same empty square, which is exactly the
// decoration `_laws.md#count-carries-predicate` forbids.

import type { ConformanceMapRow, ConformanceRow } from "@/lib/db/org-registry-conformance";
import type { KnowledgeSubjectRow } from "@/lib/db/org-registry-subjects";
import { classifyAbsence, repoStage } from "@/lib/registry/absence";
import { foldPairs, isUnknownOrStale } from "@/lib/registry/conformance-fold";
import type { KnowledgeCell, KnowledgeRepo, KnowledgeSubject } from "./knowledge-shape";

/** The mirror row, minus `indexedAt` (a mirror fact, not a subject fact). */
export function toKnowledgeSubject(row: KnowledgeSubjectRow): KnowledgeSubject {
  return {
    bundle: row.bundle,
    slug: row.slug,
    category: row.category,
    subcategory: row.subcategory,
    status: row.status,
    file: row.file,
    techniqueCount: row.techniqueCount,
    useWhen: row.useWhen,
    laws: row.laws,
    digest: row.digest,
    revision: row.revision,
    changedAt: row.changedAt,
  };
}

/**
 * THE `mapBehind` RULE: the repo's `context-map.json` moved after its registry map was built. True
 * only when BOTH revisions are known and differ. Either side null is "unknown" — an older map that
 * carries no `contextMapRevision`, or a root read the sweep could not complete — and unknown is not
 * evidence of drift. A fetch failure that read as "behind" would dispatch `map` work nobody owes.
 */
export function isMapBehind(repoContextMapRevision: string | null, contextMapRevision: string | null): boolean {
  return repoContextMapRevision !== null && contextMapRevision !== null && repoContextMapRevision !== contextMapRevision;
}

export interface KnowledgeFleet {
  /** Every swept repo, by full name. */
  repos: KnowledgeRepo[];
  /** subjects × repos, subject-major, in the input orders. */
  cells: KnowledgeCell[];
}

/**
 * Build the fleet half of the view.
 *
 * `pairs` may be the wire-capped list (`CONFORMANCE_PAIR_CAP`); when it is, a repo beyond the cap
 * has fewer pairs here than it has, and its stage can read `current` too early. The view's
 * `sweep.truncated` flag is the reader's warning, and the header counts (`pairs`, `judged`) are the
 * map's own and unaffected.
 */
export function buildKnowledgeFleet(subjects: KnowledgeSubject[], maps: ConformanceMapRow[], pairs: ConformanceRow[]): KnowledgeFleet {
  // Subjects are identified by bare slug everywhere in the registry ("technique@owner, shared_with,
  // index.json, signals/"), so the pair's `subjectSlug` is the join key and the digest lookup.
  const digestBySlug = new Map<string, string | null>(subjects.map((s) => [s.slug, s.digest]));

  // repositoryId → subjectSlug → pairs
  const byRepo = new Map<string, Map<string, ConformanceRow[]>>();
  for (const p of pairs) {
    let bySubject = byRepo.get(p.repositoryId);
    if (!bySubject) byRepo.set(p.repositoryId, (bySubject = new Map()));
    const list = bySubject.get(p.subjectSlug);
    if (list) list.push(p);
    else bySubject.set(p.subjectSlug, [p]);
  }

  const sortedMaps = [...maps].sort((a, b) => a.repoFullName.localeCompare(b.repoFullName));
  const repos: KnowledgeRepo[] = sortedMaps.map((m) => {
    const hasMap = m.mapSha !== null;
    let pairsUnknownOrStale = 0;
    for (const [slug, list] of byRepo.get(m.repositoryId) ?? []) {
      const digest = digestBySlug.get(slug) ?? null;
      for (const p of list) if (isUnknownOrStale(p, digest)) pairsUnknownOrStale += 1;
    }
    return {
      repositoryId: m.repositoryId,
      fullName: m.repoFullName,
      stage: repoStage({ hasContextMap: m.hasContextMap, hasMap, pairsUnknownOrStale }),
      hasMap,
      hasContextMap: m.hasContextMap,
      hasManifest: m.hasManifest,
      domains: m.domains,
      scope: m.scope,
      directions: m.directions,
      contexts: m.contexts,
      pairs: m.pairs,
      judged: m.judged,
      deviations: m.deviations,
      weaklyGoverned: m.weaklyGovernedContexts,
      sweptAt: m.ingestedAt,
      // The map's own churn stats (0 for a map from an older builder — "0 known", not "none").
      orphaned: m.orphanedVerdicts,
      arrived: m.arrivedContexts,
      renamed: m.renamedContexts,
      contextMapRevision: m.contextMapRevision,
      repoContextMapRevision: m.repoContextMapRevision,
      mapBehind: isMapBehind(m.repoContextMapRevision, m.contextMapRevision),
    };
  });

  const cells: KnowledgeCell[] = [];
  for (const s of subjects) {
    for (const r of repos) {
      const folded = foldPairs(byRepo.get(r.repositoryId)?.get(s.slug) ?? [], s.digest);
      cells.push(
        folded
          ? {
              subject: s.slug,
              repositoryId: r.repositoryId,
              state: folded.state,
              stale: folded.stale,
              contexts: folded.contexts,
              evidence: folded.evidence,
              contextRows: folded.contextRows,
            }
          : {
              subject: s.slug,
              repositoryId: r.repositoryId,
              state: classifyAbsence(s, { hasMap: r.hasMap, domains: r.domains, scope: r.scope, directions: r.directions }),
              stale: false,
              contexts: 0,
              evidence: null,
              contextRows: [],
            },
      );
    }
  }
  return { repos, cells };
}

/** The last sweep across the fleet: the newest `ingestedAt`, or null when nothing was ever swept. */
export function lastSweepAt(maps: ConformanceMapRow[]): string | null {
  let latest: string | null = null;
  for (const m of maps) if (latest === null || Date.parse(m.ingestedAt) > Date.parse(latest)) latest = m.ingestedAt;
  return latest;
}

/** The union of every swept repo's warnings, each prefixed with the repo it came from, capped. */
export function sweepWarnings(maps: ConformanceMapRow[], cap = 50): string[] {
  const out: string[] = [];
  for (const m of maps) for (const w of m.warnings) if (out.length < cap) out.push(`${m.repoFullName}: ${w}`);
  return out;
}
