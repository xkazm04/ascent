// Fleet orchestration for the conformance ingest (#18): read each repo's `.ai/registry-map.json`,
// parse it, persist the judged pairs.
//
// THE DEGRADE RULE, which is the whole shape of this file: one repo's failure — a 404, a truncated
// map, a revoked permission — becomes a WARNING and the sweep continues. A fleet-wide instrument
// that fails whole because one repo is unreadable would be unusable at exactly the size it matters,
// and worse, a partial failure reported as a failure hides the 40 repos that answered fine.
//
// What a repo's absence means is kept distinct at every step: "no map" (the repo has not been
// mapped) is a state, and it clears any rows a previous sweep left. "Could not read" (a transport
// failure) is a warning and CHANGES NOTHING — deleting a repo's standing deviation backlog because
// GitHub timed out would be the worst outcome available here.

import { mapPool } from "@/lib/pool";
import { clearRepoConformance, ingestRepoConformance, listSweepTargets } from "@/lib/db/org-registry-conformance";
import { countConsults, parseConformanceMap } from "./conformance-map";
import { readRepoStandardsFiles } from "./conformance-read";
import { parseFullName } from "./layout";

/** The consult window every ingested `consults30d` is counted over. */
export const CONSULT_WINDOW_DAYS = 30;

/** Repos read at once. Each is one or two GitHub reads of a large file; four keeps a big fleet's
 *  sweep from becoming a burst that trips secondary rate limits. Mirrors SCAN_CONCURRENCY. */
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

/**
 * Sweep an org's repositories. `opts.repositoryIds` narrows it; every id is constrained by `orgId`
 * in the query, so a foreign repo is simply not found rather than being gated separately.
 */
export async function sweepConformance(
  orgSlug: string,
  token: string,
  opts: { repositoryIds?: string[]; now?: Date } = {},
): Promise<SweepResult> {
  const empty: SweepResult = { scanned: 0, withMap: 0, withoutMap: 0, pairs: 0, warnings: [] };
  const targets = await listSweepTargets(orgSlug, opts.repositoryIds);
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
      if (files.map === null) {
        withoutMap += 1;
        // The map went away: the repo is no longer claiming any of those verdicts, so neither do we.
        await clearRepoConformance(repo.id).catch(() => {});
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
        warnings: [],
      });
      withMap += 1;
      pairs += written.pairs;
    } catch (err) {
      warnings.push(`${repo.fullName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return { scanned: repos.length, withMap, withoutMap, pairs, warnings: warnings.slice(0, 50) };
}
