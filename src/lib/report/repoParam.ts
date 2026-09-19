/**
 * Parse the `?repo=owner/name[@sha]` query convention shared by the report export routes
 * (PDF, SKILL.md, passport). Returns null for a malformed value.
 *
 * `sha` is whatever follows the first `@` (an empty `@` tail → undefined). This is the lenient
 * export-route parser used where a downstream lookup re-validates owner/name against persisted
 * scans; it is deliberately distinct from the stricter passport overrides/pr body parser, which
 * rejects extra slashes and has no `@sha` convention.
 */
export function parseRepoParam(q: string): { owner: string; name: string; sha?: string } | null {
  const at = q.indexOf("@");
  const base = at < 0 ? q : q.slice(0, at);
  const sha = at < 0 ? undefined : q.slice(at + 1) || undefined;
  const slash = base.indexOf("/");
  if (slash <= 0 || slash === base.length - 1) return null;
  return { owner: base.slice(0, slash), name: base.slice(slash + 1), sha };
}
