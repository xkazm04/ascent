// Forgiving GitHub repo-reference parsing, shared by every repo input surface (the hero ScanForm
// among them) so a paste that works in one place is never rejected by another. Pure and
// client-safe — deliberately independent of the server-side ingestion module.

/**
 * Peel the GitHub URL/SSH chrome off a repo reference, leaving a bare `owner/repo`-ish string (no
 * validation): strips a `git@github.com:` SSH prefix, an `https://` scheme, a `github.com/` host, a
 * leading `@` (an "@owner/repo" handle-style paste), a `.git` suffix, and surrounding slashes.
 * Shared by {@link normalizeRepo} and the inputs' paste handlers so both peel a pasted link
 * identically.
 */
export function stripRepoRef(raw: string): string {
  return raw
    .trim()
    .replace(/^git@github\.com:/i, "") // SSH form
    .replace(/^https?:\/\//i, "") // scheme
    .replace(/^(www\.)?github\.com\//i, "") // host prefix
    .replace(/^@/, "") // handle-style prefix
    .replace(/\.git$/i, "") // .git suffix
    .replace(/^\/+|\/+$/g, ""); // leading/trailing slashes
}

/** A pasted value carrying URL/SSH chrome (a scheme, a `git@` SSH prefix, or a github.com host)
 *  rather than a bare `owner/repo` — the cue to collapse it to `owner/repo` in place on paste. */
export const REPO_URL_LIKE = /:\/\/|^git@|github\.com/i;

/**
 * Forgiving client-side normalization into its parts: accepts a full URL, a `git@` SSH URL, a
 * `github.com/owner/repo`, a trailing slash, or a bare `owner/repo`, and returns `{ owner, repo }`
 * — or null when the value can't be coerced into a valid GitHub repo reference.
 */
export function parseOwnerRepo(raw: string): { owner: string; repo: string } | null {
  const s = stripRepoRef(raw);
  if (!s) return null;
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner = "", repo = ""] = parts;
  const ok = /^[A-Za-z0-9_.-]+$/;
  if (!ok.test(owner) || !ok.test(repo)) return null;
  return { owner, repo };
}

/** {@link parseOwnerRepo} joined back to a clean `owner/repo` string, or null. */
export function normalizeRepo(raw: string): string | null {
  const parsed = parseOwnerRepo(raw);
  return parsed ? `${parsed.owner}/${parsed.repo}` : null;
}

/**
 * GitHub's name grammar for a single segment (owner or repo): `[A-Za-z0-9._-]`, never starting with
 * a dot, and never containing two consecutive dots. Single-sourced here so every surface that
 * validates a pasted or routed name — the public `/scorecard/{owner}` page among them — accepts
 * exactly one set; a name like `owner/.git` must be rejected identically everywhere. Callers layer
 * their own per-segment length caps (39 for an owner, 100 for a repo) on top of this predicate.
 */
export function validRepoNamePart(s: string): boolean {
  return Boolean(s) && NAME_RE.test(s) && !s.startsWith(".") && !s.includes("..");
}

const NAME_RE = /^[A-Za-z0-9_.-]+$/;
