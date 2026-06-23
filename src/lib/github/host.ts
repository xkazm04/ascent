// GitHub host resolution — one place to point the scanner at GitHub.com (default) or a self-hosted
// GitHub Enterprise Server (GHES) behind a firewall. The bounded slice of the air-gap need (DIANE):
// a GHES deployment can already reach its own GitHub, it just needs Ascent to call that host instead
// of the hardcoded api.github.com. Uses the SAME env var names GitHub's own Actions runners set, so an
// admin reuses values they already have.
//
// GHES examples:
//   GITHUB_API_URL=https://ghe.acme.com/api/v3
//   GITHUB_GRAPHQL_URL=https://ghe.acme.com/api/graphql
//   GITHUB_RAW_URL=https://ghe.acme.com/raw        (include the /raw segment; omit on GitHub.com)
//
// Defaults are the GitHub.com hosts, so an unconfigured deployment behaves EXACTLY as before.

/** Trim + drop a trailing slash; null for blank/unset so callers fall back to the GitHub.com default. */
function envHost(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t.replace(/\/+$/, "") : null;
}

/** REST API base. GitHub.com default; `GITHUB_API_URL` for GHES (e.g. https://ghe.acme.com/api/v3). */
export function githubApiBase(): string {
  return envHost(process.env.GITHUB_API_URL) ?? "https://api.github.com";
}

/** GraphQL endpoint. GitHub.com default; `GITHUB_GRAPHQL_URL` for GHES (e.g. https://ghe.acme.com/api/graphql). */
export function githubGraphqlUrl(): string {
  return envHost(process.env.GITHUB_GRAPHQL_URL) ?? "https://api.github.com/graphql";
}

/** Raw file-content host. GitHub.com default; `GITHUB_RAW_URL` for GHES (include the /raw path segment). */
export function githubRawBase(): string {
  return envHost(process.env.GITHUB_RAW_URL) ?? "https://raw.githubusercontent.com";
}

/** The default User-Agent the REST scanner sends (most callers). */
const DEFAULT_USER_AGENT = "ascent-maturity-scanner";

/**
 * Canonical GitHub REST request headers — the other half of "consistent auth" `host.ts` centralizes
 * (the base URL is the first half). Returns `Accept`, `User-Agent`, and the pinned `X-GitHub-Api-Version`,
 * adding `Authorization: Bearer <token>` only when a token is present (keyless public scans omit it).
 * HTTP header names are case-insensitive on the wire, so the canonical TitleCase here is equivalent to
 * the lowercase variant `list.ts` previously sent.
 *
 *  - `accept`    — override the media type (e.g. `application/vnd.github.sha` for the cheap head lookup).
 *  - `userAgent` — override the UA convention per caller (org discovery / public listing set their own).
 *  - `extra`     — merge additional headers (e.g. a conditional `If-None-Match`).
 */
export function ghHeaders(
  token?: string,
  opts: { accept?: string; userAgent?: string; extra?: Record<string, string> } = {},
): Record<string, string> {
  const h: Record<string, string> = {
    Accept: opts.accept ?? "application/vnd.github+json",
    "User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
    ...opts.extra,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * `fetch()` with a per-call AbortController timeout so no upstream GitHub call can hang the function,
 * merged with an optional caller `signal` (the request's signal) — the fetch aborts on whichever fires
 * first, the timeout OR a client disconnect. The single source for this controller/timeout/merge
 * plumbing (REST source/governance + GraphQL each previously hand-rolled an identical copy); callers
 * keep their own per-module timeout value and layer their own response-shaping on top of the `Response`.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  try {
    return await fetch(url, { ...init, signal: combined });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The common fields of a GitHub `/…/repos` response row that BOTH repo-listing surfaces read (the
 * public org/user listing in list.ts and the post-OAuth user-repo discovery in discover.ts). Each
 * module extends this with the extra fields it happens to need (stars/description vs owner.type), but
 * the listing identity + the "is this a scannable repo" rule live here so they can't drift.
 */
export interface GhRepoRow {
  name: string;
  full_name: string;
  owner: { login: string };
  html_url: string;
  fork: boolean;
  archived: boolean;
  private: boolean;
}

/**
 * The product-level definition of a "listable"/scannable repo: not a fork and not archived (forks
 * aren't where active work happens; archived repos are frozen). The single source for this filter —
 * both repo-listing surfaces gate on it so they can't silently diverge on what counts as listable.
 */
export function isListableRepo(r: { fork: boolean; archived: boolean }): boolean {
  return !r.fork && !r.archived;
}
