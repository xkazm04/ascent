// Cross-instance scan cache lookup — the read side shared by /api/scan and /api/scan/stream.
//
// The cache is keyed per commit (`owner/repo@sha::mode`), so before we can check it we need the
// repo's current head sha. Naively that's a head lookup per scan; here it's a CONDITIONAL one:
// we remember the last {etag, headSha} (in-memory hint, durably mirrored on the Repository row)
// and send `If-None-Match`. GitHub answers an unchanged repo with a 304 that doesn't count
// against the rate limit, so a keyless re-scan of a quiet repo costs zero quota.
//
// Two cache tiers back the result:
//   1. in-memory  — instant on a warm serverless instance (lost on cold start).
//   2. persistent — getScanReportByCommit() rebuilds the report from the DB, so an unchanged
//                   repo returns instantly across ALL instances (and survives cold starts).
// A persistent hit warms the in-memory tier for the next reader.

import { resolveHead, type ParsedRepo } from "@/lib/github/source";
import { cacheGet, cacheSet, headHintGet, headHintSet, makeCacheKey } from "@/lib/cache";
import { getHeadHint, getScanReportByCommit } from "@/lib/db";
import type { ScanReport } from "@/lib/types";

export interface ScanCacheLookup {
  /** Where to write the fresh scan. Pinned to the resolved sha, or SHA-less if the head lookup
   *  failed (best-effort caching). Always present so the caller can cacheSet() its result. */
  cacheKey: string;
  /** Resolved head sha, or null when the conditional lookup failed entirely. */
  headSha: string | null;
  /** ETag to persist with the fresh scan so the NEXT re-scan can be conditional. Null when the
   *  head lookup failed; carried through unchanged on a 304. */
  etag: string | null;
  /** A ready report to serve immediately, or null to run a fresh scan. */
  cached: ScanReport | null;
  /** Where `cached` came from — for cache headers / progress copy. */
  source: "memory" | "db" | null;
}

/**
 * Resolve a repo's cache state for an ANONYMOUS scan (callers must gate on `!token` — installation
 * scans are per-tenant and never share this public cache). Issues a conditional head request,
 * then probes the in-memory and persistent caches.
 *
 * `fresh: true` (an explicit "re-test") skips serving any cached report but still resolves the
 * key + ETag, so the re-run is cached and the next conditional request stays cheap.
 */
export async function lookupCachedScan(opts: {
  parsed: ParsedRepo;
  useLLM: boolean;
  orgSlug?: string;
  fresh?: boolean;
}): Promise<ScanCacheLookup> {
  const { parsed, useLLM, orgSlug = "public", fresh = false } = opts;
  const { owner, repo } = parsed;

  // Prior {etag, headSha}: in-memory fast path, else the durable Repository record (cold start).
  const prior = headHintGet(owner, repo) ?? (await getHeadHint(owner, repo, { orgSlug }));

  // Conditional head lookup — a free 304 when the prior ETag still matches.
  const head = await resolveHead(parsed, { token: process.env.GITHUB_TOKEN, etag: prior?.etag ?? null });

  let headSha: string | null = null;
  let etag: string | null = null;
  if (head.status === "ok") {
    headSha = head.sha;
    etag = head.etag;
    headHintSet(owner, repo, { etag, headSha });
  } else if (head.status === "unmodified" && prior) {
    // 304 — repo unchanged. The prior sha is still current; reuse its ETag and refresh recency.
    headSha = prior.headSha;
    etag = prior.etag;
    headHintSet(owner, repo, { etag, headSha });
  } else {
    // Lookup failed (network/limit), or a 304 with no remembered sha (shouldn't happen). Fall
    // back to a SHA-less key — best-effort caching rather than failing the scan.
    return { cacheKey: makeCacheKey(owner, repo, useLLM, null), headSha: null, etag: null, cached: null, source: null };
  }

  const cacheKey = makeCacheKey(owner, repo, useLLM, headSha);

  // Explicit re-test: re-run regardless, but keep the key/etag so the result is cached.
  if (fresh) return { cacheKey, headSha, etag, cached: null, source: null };

  // Tier 1: warm in-memory instance.
  const mem = cacheGet(cacheKey);
  if (mem) return { cacheKey, headSha, etag, cached: mem, source: "memory" };

  // Tier 2: persistent (cross-instance) — rebuild the report pinned to this commit, then warm
  // the in-memory tier so the next reader on this instance skips the DB round-trip.
  const persisted = await getScanReportByCommit(owner, repo, { headSha, orgSlug }).catch(() => null);
  if (persisted) {
    cacheSet(cacheKey, persisted);
    return { cacheKey, headSha, etag, cached: persisted, source: "db" };
  }

  return { cacheKey, headSha, etag, cached: null, source: null };
}
