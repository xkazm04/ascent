// Fleet orchestration for the conformance ingest (#18): read each repo's `.ai/registry-map.json`
// and foundation files, parse them, persist ONE header row per swept repo plus the judged pairs.
//
// THE DEGRADE RULE, which is the whole shape of this file: one repo's failure — a 404, a truncated
// map, a revoked permission — becomes a WARNING and the sweep continues. A fleet-wide instrument
// that fails whole because one repo is unreadable would be unusable at exactly the size it matters,
// and worse, a partial failure reported as a failure hides the 40 repos that answered fine.
//
// What a repo's absence means is kept distinct at every step: "no map" (the repo has not been
// mapped) is a STATE — it clears the pairs a previous sweep left and writes a header row that says
// so, with the foundation facts (context map? manifest? scope? decisions?) the absence classifier
// reads. "Could not read" (a transport failure) is a warning and CHANGES NOTHING — deleting a repo's
// standing deviation backlog because GitHub timed out would be the worst outcome available here.

import { mapPool } from "@/lib/pool";
import {
  clearRepoConformance,
  ingestRepoConformance,
  listSweepTargets,
  type RepoFoundation,
} from "@/lib/db/org-registry-conformance";
import { countConsults, parseConformanceMap } from "./conformance-map";
import { EMPTY_SCOPE, parseDirectionsLedger, parseManifestFoundation } from "./conformance-foundation";
import { readRepoStandardsFiles, type RepoStandardsFiles } from "./conformance-read";
import { parseFullName } from "./layout";

/** The consult window every ingested `consults30d` is counted over. */
export const CONSULT_WINDOW_DAYS = 30;

/** Repos read at once. Each is a handful of GitHub reads, one of them a large file; four keeps a
 *  big fleet's sweep from becoming a burst that trips secondary rate limits. Mirrors SCAN_CONCURRENCY. */
export const SWEEP_CONCURRENCY = 4;

export interface SweepResult {
  /** Repos visited. */
  scanned: number;
  /** Repos that had a parseable map. */
  withMap: number;
  /** Repos whose map was absent — a state, not a failure. */
  withoutMap: number;
  /** Judged pairs ingested across the fleet. */
  pairs: number;
  warnings: string[];
}

/** What the foundation files say, as the header row stores it. Tolerant of a reader that returned
 *  the pre-rebuild shape (no `manifest` / `ledger` / `hasContextMap` keys). */
export function foundationOf(files: Pick<RepoStandardsFiles, "manifest" | "ledger" | "hasContextMap">): RepoFoundation {
  const manifest = files.manifest ?? null;
  const parsed = manifest === null ? null : parseManifestFoundation(manifest);
  return {
    hasContextMap: Boolean(files.hasContextMap),
    hasManifest: manifest !== null,
    domains: parsed?.domains ?? [],
    scope: parsed?.scope ?? EMPTY_SCOPE,
    directions: files.ledger ? parseDirectionsLedger(files.ledger) : [],
  };
}

/**
 * Sweep an org's repositories. `org` is the slug (routes) or `{ orgId }` (the indexer, chaining
 * after a pass). `opts.repositoryIds` narrows it and `opts.repositoryId` is the one-repo form (a
 * dispatch closing on one repo); every id is constrained by the org in the query, so a foreign repo
 * is simply not found rather than being gated separately.
 */
export async function sweepConformance(
  org: string | { orgId: string },
  token: string,
  opts: { repositoryIds?: string[]; repositoryId?: string; now?: Date } = {},
): Promise<SweepResult> {
  const empty: SweepResult = { scanned: 0, withMap: 0, withoutMap: 0, pairs: 0, warnings: [] };
  const ids = opts.repositoryId ? [opts.repositoryId, ...(opts.repositoryIds ?? [])] : opts.repositoryIds;
  const targets = await listSweepTargets(org, ids);
  if (!targets || !targets.repos.length) return empty;
  const { orgId, repos } = targets;

  const warnings: string[] = [];
  let withMap = 0;
  let withoutMap = 0;
  let pairs = 0;

  await mapPool(repos, SWEEP_CONCURRENCY, async (repo) => {
    // mapPool's fn must never throw or it rejects the whole pool (src/lib/pool.ts) — hence the
    // catch-everything shape here rather than at the call site.
    try {
      const ref = parseFullName(repo.fullName);
      if (!ref) {
        warnings.push(`${repo.fullName}: not a well-formed owner/name — skipped`);
        return;
      }
      const files = await readRepoStandardsFiles(token, ref.owner, ref.repo);
      const foundation = foundationOf(files);
      const repoWarnings = files.warnings ?? [];
      if (files.map === null) {
        withoutMap += 1;
        // The map went away (or never was): the repo is no longer claiming any of those verdicts,
        // so neither do we — but the header row stays, carrying the foundation facts.
        await clearRepoConformance({ orgId, repositoryId: repo.id, foundation, warnings: repoWarnings, now: opts.now }).catch(() => {});
        return;
      }
      const parsedMap = parseConformanceMap(files.map);
      if (!parsedMap.ok) {
        // A map we cannot read is NOT a map that says nothing. Rows from the last good sweep stay.
        warnings.push(`${repo.fullName}: ${parsedMap.reason} — previous conformance kept`);
        return;
      }
      const consults30d =
        files.consults === null ? null : countConsults(files.consults, CONSULT_WINDOW_DAYS, opts.now).total;
      const written = await ingestRepoConformance({
        orgId,
        repositoryId: repo.id,
        mapSha: files.mapSha ?? parsedMap.header.projectSha ?? "unknown",
        header: parsedMap.header,
        pairs: parsedMap.pairs,
        consults30d,
        warnings: repoWarnings,
        foundation,
      });
      withMap += 1;
      pairs += written.pairs;
    } catch (err) {
      warnings.push(`${repo.fullName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return { scanned: repos.length, withMap, withoutMap, pairs, warnings: warnings.slice(0, 50) };
}
