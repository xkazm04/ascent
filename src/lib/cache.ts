// Tier 1 of the two-tier scan cache: a best-effort in-memory store that makes re-scans instant on a
// warm serverless instance and softens GitHub rate limits (lost on cold start). The durable,
// cross-instance tier 2 already exists — getScanReportByCommit rebuilds a report from the DB (see
// lib/scan-cache.ts), so an unchanged repo returns fast across all instances and survives cold starts.
// This module also owns the canonical cache KEY (makeCacheKey — folds in the scoring identity) and the
// conditional-request head-hint store the read path uses to re-validate a repo's head for free.

import type { ScanReport } from "@/lib/types";
import { getProvider } from "@/lib/llm";
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";

// ---- Generic TTL + capped-LRU map ---------------------------------------------------------
// Both caches below (the scan-report `store` and the head-hint `hintStore`) are a Map<string, V> with
// a TTL and a capacity-triggered LRU eviction. They had already drifted apart on ONE axis — whether a
// `get()` refreshes recency — because each was hand-rolled separately. `refreshOnGet` makes that a
// declared parameter instead of an accident, and each cache's choice is justified at its instantiation
// below rather than flattened to whichever behavior was easier to keep.
class TtlLruCache<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    /** Whether reading an entry moves it to the MRU position. See per-cache reasoning at each
     *  `new TtlLruCache` call site — this is a deliberate per-cache choice, not a shared default. */
    private readonly refreshOnGet: boolean,
  ) {}

  get(key: string): V | null {
    const e = this.map.get(key);
    if (!e) return null;
    if (Date.now() > e.expires) {
      this.map.delete(key);
      return null;
    }
    if (this.refreshOnGet) {
      this.map.delete(key);
      this.map.set(key, e);
    }
    return e.value;
  }

  set(key: string, value: V): void {
    // Delete-then-set moves an existing key to the MRU tail on every write (both caches want this on
    // WRITE regardless of their read-side `refreshOnGet` choice), so re-writing a hot key isn't evicted
    // before colder entries. Deleting first also means the capacity check below only evicts on a TRUE
    // growth (a genuinely new key) — an overwrite that won't grow the map no longer needlessly drops a
    // valid entry.
    this.map.delete(key);
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}

const TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ENTRIES = 100;
// DECISION: refreshOnGet = true. A cache HIT here is often a terminal read with no follow-up write —
// lookupCachedScan returns the cached report directly on a memory hit and calls cacheSet only on a
// MISS (after computing/rebuilding a report). So a popular, unchanged repo (many readers, no new
// writes) would otherwise look "cold" to the capacity-triggered LRU eviction and could be dropped in
// favor of a genuinely colder entry, even though it's the most-used one. Refreshing recency on read is
// the correct semantics for this cache: it is what makes the eviction policy actually LRU (by usage)
// rather than LWU ("least written").
const store = new TtlLruCache<ScanReport>(TTL_MS, MAX_ENTRIES, true);

/**
 * Normalize a GitHub owner or repo name into a stable identity token.
 *
 * GitHub names are case-insensitive, and a value can reach us percent-encoded (a route
 * segment such as `facebook%2Dreact`) or whitespace-padded. Decoding + trimming +
 * lowercasing collapses `Facebook`, `facebook`, and `facebook%2Dreact` to one value so the
 * same repo always keys the same cache entry. Idempotent — safe to call on already-normalized
 * input. A malformed `%xx` escape falls back to the raw (trimmed) value rather than throwing.
 */
export function normalizeRepoName(name: string): string {
  const trimmed = name.trim();
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    // Malformed percent-encoding — keep the raw value.
  }
  return decoded.trim().toLowerCase();
}

/**
 * The scoring configuration a cached score is a FUNCTION of. A score is only interchangeable with
 * another when ALL of these match — swap any one and the number changes — so all three must key the
 * cache. Before this existed, the key knew only `useLLM` (llm vs mock) + the sha, so after a model
 * swap / `LLM_PROVIDER` change / rubric bump every unchanged repo kept serving the OLD score as
 * current (up to the TTL / the 7-day persisted age gate), with no bulk-invalidation lever.
 */
export interface ScoringIdentity {
  /** Resolved LLM provider name, or "mock" in mock mode. */
  provider: string;
  /** Resolved model id, or "deterministic-rubric" in mock mode. */
  model: string;
  /** SCORING_RUBRIC_VERSION at scoring time — see src/lib/maturity/model.ts. */
  rubric: string;
}

/**
 * The scoring identity the CURRENT process would produce a score under. `getProvider()` construction
 * is side-effect-free (no network), and it reads the same env the scan pipeline does, so a reader and
 * a writer on the same deployment resolve the identical identity — a reader and writer of one commit
 * therefore build the identical key. In MOCK mode the score is a pure function of the deterministic
 * rubric (the LLM provider/model are never consulted), so pinning them would only over-invalidate;
 * only the rubric version varies there.
 */
export function activeScoringIdentity(useLLM: boolean): ScoringIdentity {
  if (!useLLM) return { provider: "mock", model: "deterministic-rubric", rubric: SCORING_RUBRIC_VERSION };
  const p = getProvider();
  return { provider: p.name, model: p.model, rubric: SCORING_RUBRIC_VERSION };
}

/**
 * Dependency-free FNV-1a → 8 hex chars. NOT cryptographic — it exists only to compress the
 * provider+model+rubric triple into a short, stable, log-legible cache-key suffix instead of bloating
 * every key (and every log line) with the full `gemini:gemini-3-flash-preview:r1` string. Deterministic
 * across processes, so the same triple always yields the same suffix.
 */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Short fingerprint of the scoring identity for the cache-key suffix. NUL-joined so no field's tail
 *  can bleed into the next (e.g. provider "a"+model "bc" can't collide with provider "ab"+model "c"). */
function scoringFingerprint(useLLM: boolean, identity?: ScoringIdentity): string {
  const id = identity ?? activeScoringIdentity(useLLM);
  return shortHash(`${id.provider}\u0000${id.model}\u0000${id.rubric}`);
}

/**
 * Canonical scan-cache key. EVERY surface that reads or writes the scan cache (the scan
 * routes, the public badge, the CI gate) must build keys through this, so a single repo maps
 * to a single entry regardless of casing or percent-encoding. Otherwise `Facebook/React`,
 * `facebook/react`, and `facebook%2Freact` fragment into separate entries — and a README
 * badge can keep showing a stale mock level even after a real LLM scan exists.
 *
 * Pass the repo's current head commit `sha` to pin the entry to that commit
 * (`owner/repo@sha::mode#fp`). A new push changes the sha, so a re-scan after a commit naturally
 * misses the cache instead of serving the pre-push score for up to the TTL. Omit it (or pass
 * null when a cheap head lookup failed) to fall back to the un-pinned `owner/repo::mode#fp` form
 * — best-effort caching rather than no caching. Callers MUST resolve the sha through the same
 * resolveHead path (lookupCachedScan for the scan routes, resolveHeadWithHint for badge/gate) so
 * a reader and writer of the same commit produce the same key.
 *
 * The trailing `#fp` is a short fingerprint of the {provider, model, rubric} identity (see
 * ScoringIdentity): repo/sha/mode stay legible for logs, and the score is pinned to the exact config
 * that produced it. A model swap, an `LLM_PROVIDER` change, or a SCORING_RUBRIC_VERSION bump changes
 * `fp`, so every prior entry becomes a MISS — which is the whole point and is SAFE: a miss just
 * re-scans and re-caches under the new fingerprint. Do NOT "optimize" the fingerprint back out to reuse
 * old entries; that re-introduces the fleet-wide staleness this key was widened to fix. `identity` is
 * an explicit override for tests / a caller that already resolved it; production callers omit it and
 * the current env-derived identity is used.
 */
export function makeCacheKey(
  owner: string,
  repo: string,
  useLLM: boolean,
  sha?: string | null,
  identity?: ScoringIdentity,
): string {
  const rev = sha ? `@${sha.toLowerCase()}` : "";
  const mode = useLLM ? "llm" : "mock";
  return `${normalizeRepoName(owner)}/${normalizeRepoName(repo)}${rev}::${mode}#${scoringFingerprint(useLLM, identity)}`;
}

export function cacheGet(key: string): ScanReport | null {
  return store.get(key);
}

export function cacheSet(key: string, report: ScanReport): void {
  store.set(key, report);
}

/**
 * Drop a single scan-cache entry. The cache otherwise only evicts via TTL/LRU, so when a fresh
 * scan is persisted for the SAME head sha (a `fresh=1` re-test of an unchanged commit) a warm
 * instance would keep serving the prior report under the same `owner/repo@sha::mode` key for up
 * to the TTL. Persistence calls this after a new Scan row commits so the next read reflects it.
 * No-op when the key is absent.
 */
export function cacheDelete(key: string): void {
  store.delete(key);
}

// ---- In-flight scan coalescing ----------------------------------------------
// The scan cache is only populated AFTER scanRepository() finishes, so two requests for the SAME
// uncached commit (a React StrictMode double-mount, a /report peek-miss immediately followed by the
// streaming scan, two browser tabs, two anonymous users) each run the full GitHub ingest + LLM
// completion in parallel and pay duplicate cost + rate-limit. This coalesces concurrent scans for the
// same cache key onto ONE run: the first caller computes; later callers await the same promise.
//
// Abort is REFCOUNTED so coalescing doesn't weaken the existing abort-on-disconnect optimization: the
// shared scan is aborted only when the LAST interested caller disconnects. One client navigating away
// can no longer kill a scan that other callers (or a still-open SSE stream) are still waiting on.

interface InflightScan {
  promise: Promise<ScanReport>;
  controller: AbortController;
  waiters: number;
}
const inflightScans = new Map<string, InflightScan>();

/** Number of distinct scan computations currently in flight (test/observability hook). */
export function inflightScanCount(): number {
  return inflightScans.size;
}

/**
 * Run `factory` for `key`, or — if an identical scan is already in flight — join it and await the same
 * result instead of starting a second one. `factory` receives an AbortSignal that fires only once
 * EVERY joined caller has aborted (refcounted), so a single disconnect can't cancel work others want.
 * The entry is evicted as soon as the run settles, so a later scan of the same commit starts fresh.
 *
 * `onJoin` fires (synchronously, before awaiting) ONLY when this caller JOINED an already-in-flight
 * run rather than starting the computation. The metering routes need that distinction: both consume a
 * monthly quota slot BEFORE calling in here, and a joiner shares one ingest+LLM run — under the
 * "meter on commit, not attempt" policy (the same rule the credit side honors via `deduped`) the
 * joiner's slot must be refunded, or a StrictMode double-mount / two-tabs race silently double-charges
 * one shared computation. (scan-pipeline-ingestion #4)
 */
export function coalesceScan(
  key: string,
  factory: (signal: AbortSignal) => Promise<ScanReport>,
  signal?: AbortSignal,
  onJoin?: () => void,
): Promise<ScanReport> {
  let entry = inflightScans.get(key);
  if (!entry) {
    const controller = new AbortController();
    const created: InflightScan = { controller, waiters: 0, promise: factory(controller.signal) };
    const evict = () => {
      if (inflightScans.get(key) === created) inflightScans.delete(key);
    };
    created.promise.then(evict, evict);
    inflightScans.set(key, created);
    entry = created;
  } else {
    onJoin?.();
  }
  const e = entry;
  e.waiters += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    e.waiters -= 1;
    // Abort the shared scan only when no interested caller remains (and this is still the live entry).
    if (e.waiters <= 0 && inflightScans.get(key) === e) e.controller.abort(signal?.reason);
  };
  if (signal) {
    if (signal.aborted) release();
    else signal.addEventListener("abort", release, { once: true });
  }
  const detach = () => {
    released = true; // settled: stop this caller's abort from later decrementing/aborting a done scan
    if (signal) signal.removeEventListener("abort", release);
  };
  return e.promise.then(
    (report) => {
      detach();
      return report;
    },
    (err) => {
      detach();
      throw err;
    },
  );
}

// ---- Conditional-request head hint ------------------------------------------
// To check the per-commit scan cache (keyed `owner/repo@sha`) we first need the repo's current
// head sha — but a plain head lookup costs a rate-limit unit. The hint remembers the last
// {etag, headSha} we saw for a repo so the next lookup can be CONDITIONAL (`If-None-Match`):
// GitHub answers an unchanged repo with a free 304. This in-memory copy is the warm-instance
// fast path; the durable copy lives on Repository (headSha/headEtag) for cold starts and
// cross-instance sharing — see src/lib/scan-cache.ts and src/lib/db/scans.ts.

/** What we remember between scans to drive a conditional head request. */
export interface HeadHint {
  /** GitHub ETag from the prior head lookup (may be a weak `W/"…"` validator); null if absent. */
  etag: string | null;
  /** Head commit sha the ETag was issued for — the cache key once a 304 confirms it's current. */
  headSha: string;
}

// A stale hint is self-correcting (a 200 + fresh ETag replaces it), so the TTL is generous and
// only exists to bound memory; the cap evicts the oldest hint LRU-style.
const HINT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const HINT_MAX = 500;
// DECISION: refreshOnGet = false. Unlike the report cache, every read site in this codebase
// (lookupCachedScan, resolveHeadWithHint — see src/lib/scan-cache.ts) calls headHintGet and then, on
// every reachable branch (a fresh 200, a 304, or reusing a pre-resolved head), immediately calls
// headHintSet again for the SAME key in the same request — and `set` already refreshes recency
// unconditionally. So a get-triggered refresh would be redundant in the actual call pattern, not a
// correctness gap: an entry that's genuinely still being consulted keeps getting its recency bumped by
// the write that follows. Leaving get() non-refreshing here (rather than flattening it to match `store`)
// is the accurate choice for this cache's real usage shape, not an oversight.
const hintStore = new TtlLruCache<HeadHint>(HINT_TTL_MS, HINT_MAX, false);

function hintKey(owner: string, repo: string): string {
  return `${normalizeRepoName(owner)}/${normalizeRepoName(repo)}`;
}

export function headHintGet(owner: string, repo: string): HeadHint | null {
  return hintStore.get(hintKey(owner, repo));
}

export function headHintSet(owner: string, repo: string, hint: HeadHint): void {
  hintStore.set(hintKey(owner, repo), hint);
}
