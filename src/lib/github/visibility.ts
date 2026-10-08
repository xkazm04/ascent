// May the server's own GITHUB_TOKEN read this repo for an anonymous caller?
//
// With the GitHub App configured, a private repo is read ONLY through an installation token. An owner
// with no installation still gets the ambient operator PAT on the anonymous scan path, because public
// lookups need its rate-limit headroom (unauthenticated GitHub allows 60 requests an hour). That PAT
// commonly has broad read access, so every call made with it before the ingest's private-repo refusal
// (src/lib/scan.ts) answers differently for a private repo it can read than for a missing repo: the
// peek returned the head sha/etag, and a `?ref=` resolve answered 204 where a missing repo got 404.
//
// The fix is ONE conditional metadata read, made with the ambient token, that decides whether the
// token may be used for the rest of the request. Public ⇒ keep it. Private, or anything that cannot
// PROVE public (404, rate limit, network error, an odd body) ⇒ drop it, so every later call runs as
// nobody and a private repo answers exactly like a missing one. Fails closed by construction.
//
// COST. The ETag of each answer is remembered in memory, so an unchanged repo revalidates as a 304,
// which GitHub does not bill against the rate limit when the request is authorized. Cold: one REST
// call. Warm and unchanged: one free 304. The `/repos/{owner}/{repo}` body carries counters
// (stars, pushed_at), so an active repo's ETag moves more often than its head does.

import { isAppConfigured } from "@/lib/github/app";
import { fetchWithTimeout, ghHeaders, githubApiBase } from "@/lib/github/host";
import type { ParsedRepo } from "@/lib/forge/types";

export type RepoVisibility = "public" | "private" | "unknown";

const TIMEOUT_MS = 10_000;
/** Bounds memory only: a dropped entry costs one billed 200 on the next lookup, never a wrong answer. */
const MAX_REMEMBERED = 1000;

interface Remembered {
  etag: string;
  visibility: "public" | "private";
}

// Insertion order is recency: a write deletes then re-sets, and the oldest key is evicted at the cap.
const remembered = new Map<string, Remembered>();

function key({ owner, repo }: ParsedRepo): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}`;
}

function remember(k: string, entry: Remembered): void {
  remembered.delete(k);
  if (remembered.size >= MAX_REMEMBERED) {
    const oldest = remembered.keys().next().value;
    if (oldest !== undefined) remembered.delete(oldest);
  }
  remembered.set(k, entry);
}

/** Test seam: forget every remembered answer. */
export function resetRepoVisibilityMemo(): void {
  remembered.clear();
}

/**
 * A conditional `GET /repos/{owner}/{repo}` that reads `private` from the body. Returns "unknown" on
 * anything that is not a readable 200 or a 304 with a remembered answer; callers must treat "unknown"
 * as "not proven public". Never throws.
 */
export async function resolveRepoVisibility(
  parsed: ParsedRepo,
  opts: { token?: string; signal?: AbortSignal } = {},
): Promise<RepoVisibility> {
  const k = key(parsed);
  const prior = remembered.get(k);
  try {
    const res = await fetchWithTimeout(
      `${githubApiBase()}/repos/${parsed.owner}/${parsed.repo}`,
      {
        headers: ghHeaders(opts.token, prior ? { extra: { "If-None-Match": prior.etag } } : {}),
        // Load bearing, as on resolveHead: a framework-cached response would swallow the 304 and could
        // answer from a stale visibility.
        cache: "no-store",
      },
      TIMEOUT_MS,
      opts.signal,
    );
    if (res.status === 304) return prior ? prior.visibility : "unknown";
    if (!res.ok) {
      remembered.delete(k);
      return "unknown";
    }
    const body = (await res.json()) as { private?: unknown };
    if (typeof body?.private !== "boolean") {
      remembered.delete(k);
      return "unknown";
    }
    const visibility = body.private ? "private" : "public";
    const etag = res.headers.get("etag");
    if (etag) remember(k, { etag, visibility });
    else remembered.delete(k);
    return visibility;
  } catch {
    return "unknown";
  }
}

/**
 * The one place the anonymous scan path decides whether the ambient GITHUB_TOKEN may reach GitHub for
 * this request. Both scan routes call it where they compute `scopeToken`, after their own throttles,
 * and carry the returned `noAmbientToken` into the scope resolve, the head lookup and the ingest.
 *
 * The check runs only when all of these hold: the App is configured (self-host keeps the ambient token
 * everywhere by design), no explicit/installation token was resolved (those are already the right
 * credential), the caller is not already `noAmbientToken`, there is a parseable GitHub coordinate, and
 * an ambient token exists to protect.
 */
export async function guardAmbientToken(
  parsed: ParsedRepo | null,
  auth: { token?: string; noAmbientToken: boolean },
  opts: { signal?: AbortSignal } = {},
): Promise<{ scopeToken: string | undefined; noAmbientToken: boolean }> {
  if (auth.token) return { scopeToken: auth.token, noAmbientToken: auth.noAmbientToken };
  if (auth.noAmbientToken) return { scopeToken: undefined, noAmbientToken: true };
  const ambient = process.env.GITHUB_TOKEN || undefined;
  if (!ambient || !parsed || !isAppConfigured()) return { scopeToken: ambient, noAmbientToken: false };
  const visibility = await resolveRepoVisibility(parsed, { token: ambient, signal: opts.signal });
  return visibility === "public"
    ? { scopeToken: ambient, noAmbientToken: false }
    : { scopeToken: undefined, noAmbientToken: true };
}
