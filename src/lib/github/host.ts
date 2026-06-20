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
