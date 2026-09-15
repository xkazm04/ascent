// GitLab REST transport — the one place this adapter talks to a network.
//
// Everything else under `src/lib/forge/gitlab/` is a PURE mapper over a JSON shape, which is why the
// tests for this adapter are fixture-driven and need no live GitLab. That split is deliberate: a
// mapper that only exists inside a fetch call cannot be tested without a network, and an adapter
// nobody can test offline is an adapter nobody will keep correct.

import { fetchWithTimeout } from "@/lib/github/host";
import { GitHubError, type ForgeHost } from "@/lib/forge/types";

/** gitlab.com's API root. A self-managed instance overrides it through `ForgeHost.apiBase`. */
export const GITLAB_PUBLIC_API = "https://gitlab.com/api/v4";
export const GITLAB_PUBLIC_WEB = "https://gitlab.com";

/** Same budgets as the GitHub source: the tree read is the large one, per-file reads are capped. */
export const GITLAB_TIMEOUT_API_MS = 30_000;
export const GITLAB_TIMEOUT_FILE_MS = 15_000;

export function gitlabApiBase(host?: ForgeHost): string {
  return host?.apiBase?.replace(/\/+$/, "") ?? GITLAB_PUBLIC_API;
}

export function gitlabWebBase(host?: ForgeHost): string {
  return host?.webBase?.replace(/\/+$/, "") ?? GITLAB_PUBLIC_WEB;
}

/**
 * The project id GitLab's API accepts in a path position: either the numeric project id or the
 * URL-ENCODED full path (`group%2Fsub%2Fproject`). Encoding the WHOLE path — slashes included — is
 * required here and is the opposite of `encodePathSegments`, which preserves them; getting this
 * backwards yields a 404 on every read, so it lives in one named function.
 */
export function projectRef(fullPath: string, externalId?: string): string {
  return externalId && /^\d+$/.test(externalId) ? externalId : encodeURIComponent(fullPath);
}

export function gitlabHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "ascent-maturity-scanner",
  };
  // GitLab accepts a PAT / group access token / CI job token as a bearer. `PRIVATE-TOKEN` is the
  // older header; Bearer works for every token class we accept and is what OAuth would use too.
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Map a GitLab HTTP status onto the SAME typed error taxonomy the GitHub path uses, so every caller
 *  upstream (routes, the scan orchestrator, the gate) keeps its existing error handling unchanged.
 *  `GitHubError` is a misnomer inherited from the pre-forge tree; it is the pipeline's ingestion error
 *  type, and renaming it would churn ~40 call sites for no behaviour change. */
export function gitlabError(status: number, url: string, retryAfter?: string | null): GitHubError {
  if (status === 404 || status === 403) {
    return new GitHubError("NOT_FOUND", "Repository not found, or the token cannot read it.", status);
  }
  if (status === 429) {
    const sec = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
    return new GitHubError("RATE_LIMITED", "GitLab rate limit reached. Try again shortly.", status, sec);
  }
  return new GitHubError("UPSTREAM", `GitLab ${status} on ${url}`, status);
}

export interface GitlabFetchOpts {
  token?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  host?: ForgeHost;
}

/** One GET, returning parsed JSON and the response headers (pagination lives in the headers). */
export async function gitlabGet<T>(
  path: string,
  opts: GitlabFetchOpts = {},
): Promise<{ body: T; headers: Headers }> {
  const url = `${gitlabApiBase(opts.host)}${path}`;
  const res = await fetchWithTimeout(
    url,
    { headers: gitlabHeaders(opts.token), cache: "no-store" },
    opts.timeoutMs ?? GITLAB_TIMEOUT_API_MS,
    opts.signal,
  );
  if (!res.ok) throw gitlabError(res.status, url, res.headers.get("retry-after"));
  return { body: (await res.json()) as T, headers: res.headers };
}

/** A GET whose failure is not fatal — the enrichment convention. Returns null instead of throwing, so
 *  a missing scope degrades to "not observable" rather than failing a scan. */
export async function gitlabGetSoft<T>(path: string, opts: GitlabFetchOpts = {}): Promise<T | null> {
  try {
    return (await gitlabGet<T>(path, opts)).body;
  } catch {
    return null;
  }
}

/**
 * Follow GitLab's offset pagination through `x-next-page` (empty ⇒ last page), capped at `maxPages`.
 * The cap is the honest part: a tree read that stops at the cap sets `truncated`, which the snapshot
 * carries into `estimateCoverage` exactly as GitHub's `tree.truncated` does — a partial read reports
 * itself rather than looking like a small repo.
 */
export async function gitlabPaged<T>(
  path: string,
  maxPages: number,
  opts: GitlabFetchOpts = {},
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let page = 1;
  for (let i = 0; i < maxPages; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const { body, headers } = await gitlabGet<T[]>(`${path}${sep}page=${page}`, opts);
    if (!Array.isArray(body)) break;
    items.push(...body);
    const next = headers.get("x-next-page");
    if (!next || !/^\d+$/.test(next)) return { items, truncated: false };
    page = Number(next);
  }
  return { items, truncated: true };
}
