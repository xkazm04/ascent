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
import { activeScoringIdentity, cacheGet, cacheSet, headHintGet, headHintSet, makeCacheKey } from "@/lib/cache";
import { getHeadHint, getScanReportByCommit } from "@/lib/db";
import type { ScanReport } from "@/lib/types";

/**
 * Max age of a PERSISTED (commit-pinned) scan before it's re-scanned even when the repo's head is
 * unchanged — so a preset/popular repo that hasn't moved still gets a fresh reading roughly weekly,
 * and stale LLM analysis / rubric drift doesn't live forever behind the cross-instance cache.
 * Env-overridable (`SCAN_MAX_CACHE_AGE_DAYS`); default 7 days. Set to 0 to disable (cache never
 * ages out on commit). The in-memory tier keeps its own short TTL; this gate is the durable one.
 */
export function scanMaxCacheAgeMs(): number {
  const days = Number(process.env.SCAN_MAX_CACHE_AGE_DAYS);
  const d = Number.isFinite(days) && days >= 0 ? days : 7;
  return d * 24 * 60 * 60 * 1000;
}

/** Is a persisted scan still within the max cache age? Stale (or unparseable) → re-scan. Pure. */
export function isPersistedScanFresh(scannedAt: string | undefined, now: number = Date.now()): boolean {
  const maxAge = scanMaxCacheAgeMs();
  if (maxAge <= 0) return true; // gate disabled — never ages out
  const t = scannedAt ? new Date(scannedAt).getTime() : NaN;
  if (!Number.isFinite(t)) return false; // no/garbled timestamp → don't trust it, re-scan
  return now - t <= maxAge;
}

/**
 * Would the CURRENT scoring config reproduce this persisted report? The persistent tier shares the
 * SAME staleness the in-memory key had before it learned the scoring identity: getScanReportByCommit
 * keys only on (repo, headSha, org) — it returns the newest scan for a commit REGARDLESS of which
 * provider/model produced it — so after a model swap or `LLM_PROVIDER` change it would serve an old
 * provider's score as current, bounded only by the 7-day age gate. Gate the persisted hit on a
 * provider+model match so a swap busts the cross-instance cache too, not just warm memory.
 *
 * CONSERVATIVE: reject ONLY on a POSITIVE mismatch (the persisted stamp and the active identity are both
 * known and differ). A blank / legacy stamp (pre-column rows) is served as before rather than triggering
 * a fleet-wide re-scan storm on deploy.
 *
 * RUBRIC: the Scan row now persists `rubricVersion` (SCORING_RUBRIC_VERSION at scoring time), reconstructed
 * onto report.engine.rubricVersion. A rubric bump is therefore detected PER-ROW here — a persisted row whose
 * version differs from the active one is a miss and re-scores, instead of the DB tier serving a stale-rubric
 * score until the 7-day age gate. A legacy/null version (rows scored before the column) keeps today's
 * behavior: served, age-gated, never force-rescanned. Provider, model, AND rubric are now invalidated at
 * both cache tiers (the in-memory key folds all three into its fingerprint; this is the DB-tier twin).
 */
export function persistedMatchesActiveIdentity(report: ScanReport, useLLM: boolean): boolean {
  const want = activeScoringIdentity(useLLM);
  // Rubric self-invalidation: reject a POSITIVE mismatch (row HAS a version and it differs = a rubric bump).
  // A null/blank version is legacy — fall through to the provider/model check unchanged.
  const rubric = report.engine?.rubricVersion;
  if (rubric && rubric !== want.rubric) return false;
  const provider = report.engine?.provider;
  const model = report.engine?.model;
  if (!provider || !model) return true; // unknown/legacy stamp — don't force a re-scan
  return provider === want.provider && model === want.model;
}

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
  /**
   * A head sha/etag already resolved by an EARLIER lookup in the same logical flow — specifically
   * the /report peek → stream handoff, where the peek resolves the head, misses, and the client
   * passes the sha back. When set, skip the conditional head request entirely and reuse it, so the
   * cold-report path pays one head lookup instead of two. Trusted only as an optimization: a wrong
   * sha just keys a different (self-owned) cache entry — it can cause a self-inflicted miss/error
   * but cannot serve another commit's report or poison the shared cache.
   */
  preResolved?: { headSha: string; etag: string | null };
}): Promise<ScanCacheLookup> {
  const { parsed, useLLM, orgSlug = "public", fresh = false, preResolved } = opts;
  const { owner, repo } = parsed;

  let headSha: string | null = null;
  let etag: string | null = null;
  if (preResolved) {
    // Reuse the head the peek already resolved — no second GitHub round-trip. Refresh the
    // warm-instance hint so a later conditional request still validates for free.
    headSha = preResolved.headSha;
    etag = preResolved.etag;
    headHintSet(owner, repo, { etag, headSha });
  } else {
    // Prior {etag, headSha}: in-memory fast path, else the durable Repository record (cold start).
    const prior = headHintGet(owner, repo) ?? (await getHeadHint(owner, repo, { orgSlug }));

    // Conditional head lookup — a free 304 when the prior ETag still matches.
    const head = await resolveHead(parsed, { token: process.env.GITHUB_TOKEN, etag: prior?.etag ?? null });

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
  }

  const cacheKey = makeCacheKey(owner, repo, useLLM, headSha);

  // Explicit re-test: re-run regardless, but keep the key/etag so the result is cached.
  if (fresh) return { cacheKey, headSha, etag, cached: null, source: null };

  // Tier 1: warm in-memory instance. Age-gated with the SAME isPersistedScanFresh the DB tier uses
  // below — the memory TTL bounds how long an entry LIVES, not how old the report inside it may be. A
  // DB-tier hit warms this tier with a report that was already days old (see the cacheSet below), so
  // without this check a report that crossed scanMaxCacheAgeMs mid-TTL kept being served here while the
  // DB tier had already started re-scanning it: the documented freshness contract held on one tier and
  // not the other, purely by which instance you landed on. Both tiers now answer the same question.
  const mem = cacheGet(cacheKey);
  if (mem && isPersistedScanFresh(mem.scannedAt)) return { cacheKey, headSha, etag, cached: mem, source: "memory" };

  // Tier 2: persistent (cross-instance) — rebuild the report pinned to this commit, then warm
  // the in-memory tier so the next reader on this instance skips the DB round-trip. A persisted
  // report older than scanMaxCacheAgeMs() is treated as a miss so an unchanged-but-stale repo
  // re-scans (the weekly-refresh allowance), instead of serving an ageing snapshot forever. It's
  // ALSO a miss when a provider/model swap means the current config wouldn't reproduce it
  // (persistedMatchesActiveIdentity) — the cross-instance twin of the identity in the in-memory key,
  // so a model change busts the DB tier too instead of serving the old model's score for up to 7 days.
  const persisted = await getScanReportByCommit(owner, repo, { headSha, orgSlug }).catch(() => null);
  if (persisted && isPersistedScanFresh(persisted.scannedAt) && persistedMatchesActiveIdentity(persisted, useLLM)) {
    cacheSet(cacheKey, persisted);
    return { cacheKey, headSha, etag, cached: persisted, source: "db" };
  }

  return { cacheKey, headSha, etag, cached: null, source: null };
}

/**
 * DB-tier (cross-instance) probe for a commit the caller ALREADY knows — tier 2 of
 * {@link lookupCachedScan} without its head resolution or its in-memory tier.
 *
 * Exists for the CI gate endpoint, which is the one surface that holds an exact sha up front (either
 * `?ref=<pr-head-sha>` from the Action, or a head it resolved itself) and previously had ONLY a
 * per-instance in-memory cache: every cold serverless instance re-ingested the whole repo even
 * though the GitHub App webhook had usually just scanned — and persisted — that same sha.
 *
 * Same three gates as the persistent tier in lookupCachedScan, so the two tiers can never disagree:
 *   - the row must be pinned to THIS commit (getScanReportByCommit's headSha filter),
 *   - it must be within scanMaxCacheAgeMs (weekly-refresh allowance),
 *   - {@link persistedMatchesActiveIdentity} must hold, so a provider/model/rubric change is a miss
 *     rather than serving a score the current config would not reproduce.
 * A DB error degrades to null (a miss → the caller scans), never an exception into the CI path.
 *
 * Anonymous-safe: `orgSlug` defaults to the shared public org, and loadScanReportByCommit refuses to
 * serve a PRIVATE repo's report out of it — so this cannot become a private-repo disclosure channel
 * on the unauthenticated gate/badge surfaces.
 */
export async function lookupPersistedScanByCommit(opts: {
  owner: string;
  repo: string;
  headSha: string;
  useLLM: boolean;
  orgSlug?: string;
}): Promise<ScanReport | null> {
  const { owner, repo, headSha, useLLM, orgSlug = "public" } = opts;
  const persisted = await getScanReportByCommit(owner, repo, { headSha, orgSlug }).catch(() => null);
  if (!persisted) return null;
  if (!isPersistedScanFresh(persisted.scannedAt)) return null;
  if (!persistedMatchesActiveIdentity(persisted, useLLM)) return null;
  return persisted;
}

/**
 * Resolve a repo's current head sha for the read-only badge/gate surfaces while reusing the
 * in-memory conditional-request hint. Unlike an unconditional head lookup, this sends the prior
 * ETag (`If-None-Match`): an unchanged repo answers `304 Not Modified`, which GitHub does NOT
 * bill against the REST rate limit, so a README badge polled by every repo viewer re-validates
 * for free instead of spending a rate-limit unit per hit. The hint is refreshed on a fresh `200`.
 * Returns null on any failure so the caller falls back to a SHA-less (best-effort) cache key.
 */
export async function resolveHeadWithHint(parsed: ParsedRepo, token?: string): Promise<string | null> {
  const { owner, repo } = parsed;
  const prior = headHintGet(owner, repo);
  const head = await resolveHead(parsed, { token, etag: prior?.etag ?? null });
  if (head.status === "ok") {
    headHintSet(owner, repo, { etag: head.etag, headSha: head.sha });
    return head.sha;
  }
  if (head.status === "unmodified" && prior) {
    headHintSet(owner, repo, { etag: prior.etag, headSha: prior.headSha });
    return prior.headSha;
  }
  return null;
}
