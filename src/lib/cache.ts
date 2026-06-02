// Best-effort in-memory scan cache. Within a warm serverless instance this makes
// re-scans instant and softens GitHub rate limits. Phase 2 replaces this with Aurora
// DSQL-backed persistence (see docs/ARCHITECTURE.md).

import type { ScanReport } from "@/lib/types";

interface Entry {
  report: ScanReport;
  expires: number;
}

const TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ENTRIES = 100;
const store = new Map<string, Entry>();

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
 * Canonical scan-cache key. EVERY surface that reads or writes the scan cache (the scan
 * routes, the public badge, the CI gate) must build keys through this, so a single repo maps
 * to a single entry regardless of casing or percent-encoding. Otherwise `Facebook/React`,
 * `facebook/react`, and `facebook%2Freact` fragment into separate entries — and a README
 * badge can keep showing a stale mock level even after a real LLM scan exists.
 *
 * Pass the repo's current head commit `sha` to pin the entry to that commit
 * (`owner/repo@sha::mode`). A new push changes the sha, so a re-scan after a commit naturally
 * misses the cache instead of serving the pre-push score for up to the TTL. Omit it (or pass
 * null when a cheap head lookup failed) to fall back to the un-pinned `owner/repo::mode` form
 * — best-effort caching rather than no caching. Callers MUST resolve the sha through the same
 * resolveHead path (lookupCachedScan for the scan routes, resolveHeadWithHint for badge/gate) so
 * a reader and writer of the same commit produce the same key.
 */
export function makeCacheKey(
  owner: string,
  repo: string,
  useLLM: boolean,
  sha?: string | null,
): string {
  const rev = sha ? `@${sha.toLowerCase()}` : "";
  return `${normalizeRepoName(owner)}/${normalizeRepoName(repo)}${rev}::${useLLM ? "llm" : "mock"}`;
}

export function cacheGet(key: string): ScanReport | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    store.delete(key);
    return null;
  }
  // refresh LRU recency
  store.delete(key);
  store.set(key, e);
  return e.report;
}

export function cacheSet(key: string, report: ScanReport): void {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  store.set(key, { report, expires: Date.now() + TTL_MS });
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

interface HintEntry extends HeadHint {
  expires: number;
}

// A stale hint is self-correcting (a 200 + fresh ETag replaces it), so the TTL is generous and
// only exists to bound memory; the cap evicts the oldest hint LRU-style.
const HINT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const HINT_MAX = 500;
const hintStore = new Map<string, HintEntry>();

function hintKey(owner: string, repo: string): string {
  return `${normalizeRepoName(owner)}/${normalizeRepoName(repo)}`;
}

export function headHintGet(owner: string, repo: string): HeadHint | null {
  const key = hintKey(owner, repo);
  const e = hintStore.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    hintStore.delete(key);
    return null;
  }
  return { etag: e.etag, headSha: e.headSha };
}

export function headHintSet(owner: string, repo: string, hint: HeadHint): void {
  const key = hintKey(owner, repo);
  // Refresh recency: delete-then-set moves the key to the tail so the cap evicts the LRU entry.
  hintStore.delete(key);
  if (hintStore.size >= HINT_MAX) {
    const oldest = hintStore.keys().next().value;
    if (oldest) hintStore.delete(oldest);
  }
  hintStore.set(key, { ...hint, expires: Date.now() + HINT_TTL_MS });
}
