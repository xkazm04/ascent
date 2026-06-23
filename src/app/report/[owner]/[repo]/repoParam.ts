// Permalink segment parser for /report/{owner}/{repo} and /report/{owner}/{repo}@{headSha}.
//
// Distinct from @/lib/report/repoParam's parseRepoParam (which parses a `?repo=owner/name[@sha]`
// QUERY value and returns `{ owner, name, sha? } | null`): here the `owner` arrives as its own route
// segment, so this splits only the `repo` segment into `name`/`sha` and never returns null. Shared by
// page.tsx and the co-located opengraph-image.tsx so the permalink grammar lives in one place.

/** Split a `repo` path segment that may carry a pinned commit: `name` or `name@sha`. */
export function parseRepoParam(repoParam: string): { name: string; sha?: string } {
  const at = repoParam.indexOf("@");
  if (at < 0) return { name: repoParam };
  return { name: repoParam.slice(0, at), sha: repoParam.slice(at + 1) || undefined };
}
