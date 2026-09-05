// Permalink segment parser for /report/{owner}/{repo} and /report/{owner}/{repo}@{headSha}.
//
// Distinct from @/lib/report/repoParam's parseRepoParam (which parses a `?repo=owner/name[@sha]`
// QUERY value and returns `{ owner, name, sha? } | null`): here the `owner` arrives as its own route
// segment, so this splits only the `repo` segment into `name`/`sha` and never returns null. Shared by
// page.tsx and the co-located opengraph-image.tsx so the permalink grammar lives in one place.

/**
 * Percent-decode a route segment ONCE, defensively.
 *
 * Next hands `params` through already-decoded in most paths, but a pinned permalink copied out of the
 * address bar arrives with the `@` still encoded as `%40` (browsers encode it when the user copies /
 * re-types the URL, and some proxies re-encode it). Without this, `next.js%40abc` never splits and the
 * page dead-ends on "No report yet for vercel/next.js%40…" with a recovery CTA that scans a repo which
 * does not exist. Already-decoded input is returned untouched (no `%` → nothing to do), and a MALFORMED
 * sequence (`foo%zz`, a lone `%`) must never throw a 500 on a shared link — it falls back to the raw
 * segment, which is exactly today's behaviour.
 */
function decodeSegment(segment: string): string {
  if (!segment.includes("%")) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Split a `repo` path segment that may carry a pinned commit: `name` or `name@sha`. Percent-encoded
 *  segments (`name%40sha`) are decoded first, so every call site resolves an encoded permalink. */
export function parseRepoParam(repoParam: string): { name: string; sha?: string } {
  const decoded = decodeSegment(repoParam);
  const at = decoded.indexOf("@");
  if (at < 0) return { name: decoded };
  return { name: decoded.slice(0, at), sha: decoded.slice(at + 1) || undefined };
}
