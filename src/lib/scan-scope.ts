// Scan SCOPE — the two ways an interactive scan can target something other than "this repo's default
// branch, whole tree": a git `ref` (branch/tag/commit) and a monorepo `subPath`. Pure + dependency-free
// so both scan routes, the cache-key builder and the UI can share one definition (and unit-test it
// without touching the network).
//
// WHY THIS MODULE EXISTS AT ALL — three invariants that were easy to get wrong separately:
//
//  1. IDENTITY. The scan cache and the persisted Scan row are keyed on the resolved COMMIT SHA
//     (`owner/repo@sha`). A ref selector that ingests `develop` while the key was built from the
//     DEFAULT branch's head would store develop's score under main's commit — two refs colliding on
//     one entry, exactly the failure the ref work must not introduce. So a ref is always resolved
//     SERVER-SIDE to its own 40-hex commit sha and that sha keys the entry; a `subPath` is not a
//     commit at all, so it is folded in as an explicit key SEGMENT (see makeCacheKey's `scope`).
//
//  2. SUBJECT. A scoped report is a report about a DIFFERENT SUBJECT than "this repository". The
//     public corpus (the leaderboard, /report's "latest", org rollups, regression alerts) reads the
//     repo's most recent persisted row, so persisting a feature-branch or single-package score would
//     silently redefine what the repo scores — and would fire a regression alert on a branch that was
//     never meant to be the baseline. Scoped scans are therefore NEVER persisted. This is the same
//     rule /api/gate already follows on its `?ref=` path.
//
//  3. TRUST. Because a scoped scan never enters the shared corpus, a client-supplied ref cannot be
//     used to get a flattering cherry-picked commit scored, saved, and later served as the repo's
//     public reading — the attack /api/scan/stream's "never trust body.headSha" comment describes.
//     The ref still passes the charset guard below before it reaches any URL builder.

/** Longest git ref we accept. Git itself has no hard limit; this bounds the URL/cache-key surface. */
const MAX_REF_LENGTH = 255;
/** Longest monorepo sub-path we accept. */
const MAX_SUBPATH_LENGTH = 200;

/**
 * Is this a syntactically valid, safely-encodable git ref (branch, tag, or commit sha)?
 *
 * Follows the shape of `git check-ref-format` for the parts that matter here, and is deliberately
 * STRICTER than git in charset: only `[A-Za-z0-9._/-]`, so nothing reaching the GitHub REST/raw URL
 * builders can carry a query string, a fragment, whitespace, or a path traversal. Rejects the classic
 * git-invalid shapes too (`..`, a leading/trailing `/`, `//`, a trailing `.lock`, a leading `-`), so a
 * ref that could never resolve is refused up front instead of costing a GitHub round-trip.
 */
export function isValidGitRef(ref: string): boolean {
  if (!ref || ref.length > MAX_REF_LENGTH) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) return false;
  if (ref.startsWith("-") || ref.startsWith("/") || ref.endsWith("/")) return false;
  if (ref.includes("..") || ref.includes("//")) return false;
  if (ref.endsWith(".") || ref.endsWith(".lock")) return false;
  // A path SEGMENT may not start with a dot either (`feature/.hidden` is not a valid ref).
  if (ref.split("/").some((seg) => seg.length === 0 || seg.startsWith("."))) return false;
  return true;
}

/**
 * Normalize a monorepo sub-path to a clean, traversal-free, POSIX-relative directory prefix — or null
 * when it can't be one. Strips surrounding slashes and a `./` prefix; rejects `..`, backslashes,
 * absolute paths, and anything outside `[A-Za-z0-9._/-]`.
 *
 * Returns the prefix WITHOUT a trailing slash (`packages/api`), which is the form
 * {@link isUnderSubPath} compares against.
 */
export function normalizeSubPath(raw: string): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
  if (!s) return null;
  if (s.length > MAX_SUBPATH_LENGTH) return null;
  if (!/^[A-Za-z0-9._/-]+$/.test(s)) return null;
  if (s.includes("//")) return null;
  if (s.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  // Collapse to a canonical, lower-risk form: no trailing slash (already stripped above).
  s = s.replace(/\/+$/, "");
  return s || null;
}

/** Is `path` inside the `subPath` directory (or the directory entry itself)? Prefix-safe: `packages/a`
 *  does NOT match `packages/api/…`. */
export function isUnderSubPath(path: string, subPath: string): boolean {
  return path === subPath || path.startsWith(`${subPath}/`);
}

/**
 * The scope a scan actually ran under, as resolved by the route. `refSha` is the ref's OWN commit sha
 * (never the default branch's), which is what pins ingestion and keys the cache.
 */
export interface ScanScope {
  /** The ref the user asked for, verbatim — display only (`develop`, `v2.1.0`, a sha). */
  ref?: string;
  /** The 40-hex commit `ref` resolved to, server-side. */
  refSha?: string;
  /** Normalized monorepo sub-path (no trailing slash). */
  subPath?: string;
}

/**
 * Is this scan about something OTHER than "the whole repo at its default-branch head"?
 *
 * True ⇒ the report must not be persisted to the shared corpus and must not be served as the repo's
 * latest reading (invariant 2 above). A ref that resolves to the SAME commit as the default head is
 * NOT scoped: the ingested tree, the signals and therefore the score are byte-for-byte what a normal
 * default-branch scan produces, so treating it as a normal scan is both correct and free cache reuse.
 * A sub-path is always scoped — it deliberately re-aims the content budget at one package.
 */
export function isScopedScan(scope: ScanScope, defaultHeadSha: string | null): boolean {
  if (scope.subPath) return true;
  if (!scope.refSha) return false;
  if (!defaultHeadSha) return true; // couldn't prove it's the default head → assume scoped (safe side)
  return scope.refSha.toLowerCase() !== defaultHeadSha.toLowerCase();
}

/**
 * The cache-key SEGMENT that keeps a scoped entry from ever colliding with the default-branch entry
 * for the same commit — the `subPath` half of invariant 1. Returns undefined for an unscoped scan so
 * default-branch keys stay byte-for-byte what they were before ref/sub-path support existed.
 *
 * The `ref` itself is deliberately NOT in the segment: two different ref NAMES pointing at the same
 * commit produce the identical tree, files and commit list, so they are the same scan and SHOULD share
 * an entry. Only the sub-path changes what is actually read at a given commit.
 */
export function scopeCacheSegment(scope: ScanScope): string | undefined {
  return scope.subPath ? `path:${scope.subPath}` : undefined;
}

/**
 * Human-readable caveat stamped on a scoped report's `warnings`, so nobody reads a branch/package
 * score as the repository's score.
 *
 * It states BOTH consequences, because a reader needs both: the score isn't comparable with the
 * default-branch corpus (the leaderboard, the org rollups, this repo's own history are all
 * default-branch, whole-repo readings), and the scan deliberately wasn't saved — which is why
 * re-opening the report without the branch/sub-path shows the ordinary score instead.
 */
export function scopeWarning(scope: ScanScope): string | null {
  const parts: string[] = [];
  if (scope.ref && scope.refSha) parts.push(`the \`${scope.ref}\` ref instead of the default branch`);
  if (scope.subPath) parts.push(`only the \`${scope.subPath}/\` sub-tree for its code sample`);
  if (!parts.length) return null;
  return `This scan read ${parts.join(" and ")}. Scores are not comparable with default-branch, whole-repository scans, and this reading was not saved to the repository's history.`;
}
