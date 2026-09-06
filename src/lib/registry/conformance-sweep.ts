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
import { githubAppFetch } from "@/lib/github/app";
import { encodePathSegments } from "@/lib/github/host";
import {
  clearRepoConformance,
  ingestRepoConformance,
  listSweepTargets,
  type RepoFoundation,
} from "@/lib/db/org-registry-conformance";
import { OPEN_DISPATCH_STATUSES, listDispatches, markDispatch } from "@/lib/db/org-registry-dispatch";
import { countConsults, parseConformanceMap, parseContextMapRevision, type ConformancePair } from "./conformance-map";
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

/** The repo's own context map at the root — the ONE file the sweep reads beyond `.ai/`. */
const REPO_CONTEXT_MAP_PATH = "context-map.json";

/** Ceiling on the context-map body. This repo's is ~170KB; the cap bounds a fleet sweep's memory,
 *  and a map past it reads as "revision unknown" — never as "behind". */
export const MAX_CONTEXT_MAP_BYTES = 512 * 1024;

/**
 * The `revision` of the repo's `context-map.json`, or null. ONE additional Contents read per swept
 * repo that has the file; skipped (null) when the root listing said it is not there.
 *
 * NEVER throws and never fails the sweep: a 404, a 403, a transport error, an oversized body or a
 * document that is not JSON all come back as null, which the fleet builder reads as "unknown" and
 * `mapBehind` reads as false. The map was already read by the time this runs, so the worst this
 * degrade can cost is the drift signal for one repo — never the repo's standing verdicts.
 */
export async function readContextMapRevision(token: string, owner: string, repo: string): Promise<string | null> {
  try {
    const file = await githubAppFetch<{ content?: string; encoding?: string; size?: number; type?: string }>(
      `/repos/${owner}/${repo}/contents/${encodePathSegments(REPO_CONTEXT_MAP_PATH)}`,
      token,
    );
    if (file.type !== "file" || !file.content) return null;
    if ((file.size ?? 0) > MAX_CONTEXT_MAP_BYTES) return null;
    if (file.encoding && file.encoding !== "base64") return null;
    const buf = Buffer.from(file.content, "base64");
    if (buf.byteLength > MAX_CONTEXT_MAP_BYTES) return null;
    return parseContextMapRevision(buf.toString("utf8"));
  } catch {
    // A 404 / 403 is the expected shape of "not readable"; a transport failure costs the same —
    // this one signal for this one repo — so neither is distinguished here.
    return null;
  }
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
      // The context map's revision is read only when the root listing saw the file: a repo at stage
      // `populate` has none, and a request for it would be a request for a known 404.
      const repoContextMapRevision = foundation.hasContextMap ? await readContextMapRevision(token, ref.owner, ref.repo) : null;
      if (files.map === null) {
        withoutMap += 1;
        // The map went away (or never was): the repo is no longer claiming any of those verdicts,
        // so neither do we — but the header row stays, carrying the foundation facts.
        await clearRepoConformance({ orgId, repositoryId: repo.id, foundation, warnings: repoWarnings, now: opts.now, repoContextMapRevision }).catch(() => {});
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
      const mapSha = files.mapSha ?? parsedMap.header.projectSha ?? "unknown";
      const written = await ingestRepoConformance({
        orgId,
        repositoryId: repo.id,
        mapSha,
        header: parsedMap.header,
        pairs: parsedMap.pairs,
        consults30d,
        warnings: repoWarnings,
        foundation,
        repoContextMapRevision,
      });
      withMap += 1;
      pairs += written.pairs;
      await closeDispatches(orgId, repo, mapSha, parsedMap.pairs, opts.now, warnings);
    } catch (err) {
      warnings.push(`${repo.fullName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return { scanned: repos.length, withMap, withoutMap, pairs, warnings: warnings.slice(0, 50) };
}

/**
 * THE SWEEP CLOSES DISPATCHES — the return path of the Knowledge base's hand-offs (WP2). A dispatch
 * row is `done` only when the sweep OBSERVES the map move: `mapSha` differs from the row's
 * `mapShaBefore` (a null before means any map counts), and — for `conform` — none of the subjects
 * the brief named still has an `unjudged` pair in the freshly ingested map. Nothing the agent or
 * the runner said is consulted; the codebase is the only witness.
 *
 * Best-effort like everything else here: a ledger read or write that fails is a WARNING on the
 * sweep, never a failure of the ingest that just succeeded.
 */
async function closeDispatches(
  orgId: string,
  repo: { id: string; fullName: string },
  mapSha: string,
  pairs: ConformancePair[],
  now: Date | undefined,
  warnings: string[],
): Promise<void> {
  let open;
  try {
    open = (await listDispatches(orgId, { repositoryId: repo.id })).filter((d) => OPEN_DISPATCH_STATUSES.includes(d.status));
  } catch (err) {
    warnings.push(`${repo.fullName}: dispatches not read (${err instanceof Error ? err.message : String(err)})`);
    return;
  }
  if (!open.length) return;
  const unjudged = new Set(pairs.filter((p) => p.state === "unjudged").map((p) => p.subjectSlug));
  for (const d of open) {
    if (d.mapShaBefore !== null && d.mapShaBefore === mapSha) continue;
    if (d.stage === "conform" && d.subjects.some((s) => unjudged.has(s))) continue;
    try {
      await markDispatch(orgId, d.id, { status: "done", mapShaAfter: mapSha, endedAt: now ?? new Date() });
    } catch (err) {
      warnings.push(`${repo.fullName}: dispatch ${d.id} not closed (${err instanceof Error ? err.message : String(err)})`);
    }
  }
}
