// Shared GitHub repo listing — used by the onboarding selector (/api/org/repos) and the
// bulk import (/api/org/import). Lists a public org's (falling back to a user's) repos,
// most-recently-pushed first, filtering out forks and archived repos.

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

interface GhRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  html_url: string;
  fork: boolean;
  archived: boolean;
  private: boolean;
  stargazers_count: number;
  pushed_at: string;
  description: string | null;
}

// GitHub login grammar: alphanumerics and single hyphens, ≤39 chars. Validating BEFORE the value is
// interpolated into the api.github.com URL stops a crafted `org` (e.g. containing `../`, `@`, or
// URL-control chars) from rewriting the request path/host — an SSRF / path-injection vector, since
// `org` reaches here unauthenticated via /api/org/repos and /api/org/import.
const VALID_HANDLE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export async function listOrgRepos(org: string, count: number, token?: string): Promise<OrgRepoListItem[]> {
  if (!VALID_HANDLE.test(org)) {
    throw new Error(`Invalid GitHub org/user handle: "${org}"`);
  }
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "ascent-org-listing",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const perPage = Math.min(100, Math.max(1, count * 2)); // over-fetch; we filter forks/archived
  const qs = `sort=pushed&direction=desc&type=public&per_page=${perPage}`;

  for (const base of [`https://api.github.com/orgs/${org}/repos`, `https://api.github.com/users/${org}/repos`]) {
    const res = await fetch(`${base}?${qs}`, { headers });
    if (res.status === 404) continue; // not an org → try user
    if (!res.ok) throw new Error(`GitHub list failed (${res.status}) for ${org}`);
    const all = (await res.json()) as GhRepo[];
    return all
      .filter((r) => !r.fork && !r.archived)
      .slice(0, count)
      .map((r) => ({
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        url: r.html_url,
        isPrivate: r.private,
        stars: r.stargazers_count ?? 0,
        pushedAt: r.pushed_at,
        description: r.description ?? "",
      }));
  }
  throw new Error(`No public org or user named "${org}".`);
}
