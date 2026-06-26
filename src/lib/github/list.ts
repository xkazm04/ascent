// Shared GitHub repo listing — used by the onboarding selector (/api/org/repos) and the
// bulk import (/api/org/import). Lists a public org's (falling back to a user's) repos,
// most-recently-pushed first, filtering out forks and archived repos.

import { fetchWithTimeout, ghHeaders, githubApiBase, isListableRepo, type GhRepoRow } from "@/lib/github/host";

// Per-page request timeout so a stalled GitHub connection (TCP accepted, response never arrives —
// the same partial-outage mode that hangs discovery) can't hang /api/org/repos or /api/org/import
// (github-repo-data-access #1). Bounds each page fetch; the caller's optional signal aborts too.
const TIMEOUT_MS = 12_000;

export interface OrgRepoListItem {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  isPrivate: boolean;
  stars: number;
  pushedAt: string;
  description: string;
}

interface GhRepo extends GhRepoRow {
  stargazers_count: number;
  pushed_at: string;
  description: string | null;
}

// GitHub login grammar: alphanumerics and single hyphens, ≤39 chars. Validating BEFORE the value is
// interpolated into the api.github.com URL stops a crafted `org` (e.g. containing `../`, `@`, or
// URL-control chars) from rewriting the request path/host — an SSRF / path-injection vector, since
// `org` reaches here unauthenticated via /api/org/repos and /api/org/import.
const VALID_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
// GitHub repo names: [A-Za-z0-9._-], ≤100, never starting with a dot or containing ".." (traversal).
const REPO_NAME_RE = /^[A-Za-z0-9._-]+$/;

/** True for a valid GitHub org/user handle (login grammar). Exported so untrusted callers (the import
 *  route's `repos[]`) can validate BEFORE any value is interpolated into a github.com URL. */
export function isValidHandle(s: string): boolean {
  return VALID_HANDLE.test(s);
}

/** True for a valid GitHub repository name (allows dots/underscores, unlike a login). */
export function isValidRepoName(s: string): boolean {
  return Boolean(s) && s.length <= 100 && REPO_NAME_RE.test(s) && !s.startsWith(".") && !s.includes("..");
}

/** Typed GitHub-listing failure so callers can map a rate-limit / auth / not-found to the RIGHT HTTP
 *  status instead of collapsing every throw to 404 (which hid rate limits + auth outages as "no such org"). */
export class GitHubListError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "RATE_LIMITED" | "AUTH" | "UPSTREAM",
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "GitHubListError";
  }
}

/** Parse the `rel="next"` URL out of a GitHub `Link` header, or null when there's no next page. */
function nextPageUrl(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    if (/rel="next"/.test(part)) {
      const m = part.match(/<([^>]+)>/);
      if (m) return m[1]!;
    }
  }
  return null;
}

const MAX_LIST_PAGES = 5; // backfill across up to 5 pages of 100 before giving up on `count` results

export async function listOrgRepos(org: string, count: number, token?: string, signal?: AbortSignal): Promise<OrgRepoListItem[]> {
  if (!VALID_HANDLE.test(org)) {
    throw new GitHubListError(`Invalid GitHub org/user handle: "${org}"`, "NOT_FOUND");
  }
  // Canonical header set (TitleCase keys — HTTP header names are case-insensitive on the wire, so
  // this is equivalent to the lowercase variant this listing previously sent). Authorization is
  // added only when a token is present.
  const headers = ghHeaders(token, { userAgent: "ascent-org-listing" });
  const map = (r: GhRepo): OrgRepoListItem => ({
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    url: r.html_url,
    isPrivate: r.private,
    stars: r.stargazers_count ?? 0,
    pushedAt: r.pushed_at,
    description: r.description ?? "",
  });

  // Fetch FULL 100-repo pages and FILTER forks/archived inside the pagination loop, following the
  // Link header's rel="next" until we have `count` post-filter results or pages are exhausted. The old
  // single `per_page=count*2` fetch returned far fewer than `count` (sometimes zero) for fork-heavy /
  // archived-heavy orgs once count ≥ 50, and reported that short list as complete.
  const api = githubApiBase();
  for (const base of [`${api}/orgs/${org}/repos`, `${api}/users/${org}/repos`]) {
    const collected: OrgRepoListItem[] = [];
    let url: string | null = `${base}?sort=pushed&direction=desc&type=public&per_page=100`;
    let probed = false; // have we gotten a successful first page from this base?
    for (let page = 0; page < MAX_LIST_PAGES && url; page++) {
      const res = await fetchWithTimeout(url, { headers }, TIMEOUT_MS, signal);
      if (res.status === 404 && !probed) break; // not an org → try the /users/ base
      // Don't mask a rate limit / auth failure as "not found": surface a typed error so the route can
      // return 429/502 with a Retry-After instead of a misleading 404 for a real account.
      if (res.status === 403 || res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || undefined;
        // A present Retry-After on a 403 is GitHub's SECONDARY (abuse) rate limit — x-ratelimit-remaining
        // stays > 0, so keying only on remaining===0 misreported it as an AUTH/permissions denial ("GitHub
        // denied listing"). Treat a present Retry-After as rate-limited too so callers back off rather than
        // being told to fix permissions. (github-repo-data-access #2)
        const rateLimited =
          res.status === 429 ||
          res.headers.get("x-ratelimit-remaining") === "0" ||
          retryAfter !== undefined;
        throw new GitHubListError(
          rateLimited ? `GitHub rate limit hit while listing "${org}".` : `GitHub denied listing "${org}" (403).`,
          rateLimited ? "RATE_LIMITED" : "AUTH",
          retryAfter,
        );
      }
      if (res.status === 401) throw new GitHubListError(`GitHub auth failed listing "${org}".`, "AUTH");
      if (!res.ok) throw new GitHubListError(`GitHub list failed (${res.status}) for "${org}".`, "UPSTREAM");
      probed = true;
      const all = (await res.json()) as GhRepo[];
      for (const r of all) {
        if (!isListableRepo(r)) continue;
        collected.push(map(r));
        if (collected.length >= count) return collected.slice(0, count);
      }
      url = nextPageUrl(res.headers.get("link"));
    }
    if (probed) return collected.slice(0, count); // ran out of pages/repos for this base — return what we have
  }
  throw new GitHubListError(`No public org or user named "${org}".`, "NOT_FOUND");
}
