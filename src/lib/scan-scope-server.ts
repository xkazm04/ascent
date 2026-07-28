// Server half of scan SCOPE (src/lib/scan-scope.ts is the pure, client-safe half): turn a request's
// raw `ref` / `subPath` into a resolved, validated {commit sha, sub-path} the scan pipeline and the
// cache key can both be built from — or a ready-to-return error.
//
// Single-sourced across /api/scan and /api/scan/stream because the three rules below have to hold
// IDENTICALLY on both, and two hand-kept copies of a cache-safety rule is exactly how a collision gets
// reintroduced:
//
//   1. The ref is RESOLVED SERVER-SIDE to its own 40-hex commit sha. The cache key and the persisted
//      row are keyed on a commit; keying a `develop` scan by the DEFAULT branch's head is the two-refs-
//      one-entry collision the ref selector must not introduce.
//   2. An unresolvable ref is an ERROR, never a silent fall-back to the default branch — falling back
//      would score a tree the user did not ask for and label it with their branch name.
//   3. Scoped-ness is decided against the repo's REAL default-branch head, so `?ref=main` (or a sha
//      that happens to be the head) is recognised as an ordinary scan and keeps full cache reuse and
//      normal persistence, instead of being needlessly demoted.

import { resolveRefSha, type ParsedRepo } from "@/lib/github/source";
import { isValidGitRef, normalizeSubPath, type ScanScope } from "@/lib/scan-scope";

export interface ResolvedScanScope {
  /** null when the inputs were fine; otherwise the reason, for the route to render as 400/404. */
  error: { message: string; code: "INVALID_REF" | "INVALID_SUBPATH" | "REF_NOT_FOUND"; status: number } | null;
  /** The user's ref verbatim (display), the sha it resolved to, and the normalized sub-path. */
  scope: ScanScope;
  /** Commit sha to pin ingestion + the cache key to. Null when the scan isn't scoped at all, or when
   *  a sub-path-only scan couldn't resolve the default head (best-effort, SHA-less key). */
  pinSha: string | null;
  /** Whether ANY scope input was supplied — i.e. whether the route must take the scoped path at all. */
  requested: boolean;
}

/** The "no scope was requested" result — also what a route uses when there is no parseable repo to
 *  resolve a scope against. Frozen so a caller can't mutate the shared instance. */
export const UNSCOPED: ResolvedScanScope = Object.freeze({
  error: null,
  scope: {},
  pinSha: null,
  requested: false,
});

const OK_UNSCOPED = UNSCOPED;

/**
 * Validate + resolve a request's scope inputs. Performs at most ONE extra GitHub call (the ref
 * resolve) and none at all when neither input is present, so the ordinary scan path is untouched.
 *
 * `token` must already be ambient-guarded by the caller (i.e. undefined when `noAmbientToken`), so a
 * ref resolve can't confirm a private repo's branches through the operator PAT.
 */
export async function resolveScanScope(
  parsed: ParsedRepo,
  raw: { ref?: unknown; subPath?: unknown },
  opts: { token?: string; signal?: AbortSignal } = {},
): Promise<ResolvedScanScope> {
  const rawRef = typeof raw.ref === "string" ? raw.ref.trim() : "";
  const rawSubPath = typeof raw.subPath === "string" ? raw.subPath.trim() : "";
  if (!rawRef && !rawSubPath) return OK_UNSCOPED;

  let subPath: string | undefined;
  if (rawSubPath) {
    const normalized = normalizeSubPath(rawSubPath);
    if (!normalized) {
      return {
        ...OK_UNSCOPED,
        requested: true,
        error: {
          code: "INVALID_SUBPATH",
          status: 400,
          message: "Sub-path must be a relative directory inside the repository, e.g. packages/api.",
        },
      };
    }
    subPath = normalized;
  }

  if (!rawRef) {
    // Sub-path only: the subject is still the default branch, so nothing to resolve here. The caller
    // pins the default head it already resolves for the cache key.
    return { error: null, scope: { subPath }, pinSha: null, requested: true };
  }

  if (!isValidGitRef(rawRef)) {
    return {
      ...OK_UNSCOPED,
      requested: true,
      error: {
        code: "INVALID_REF",
        status: 400,
        message: "Branch, tag or commit must be a valid git ref, e.g. develop, release/2.1 or a commit SHA.",
      },
    };
  }

  const refSha = await resolveRefSha(parsed, rawRef, opts);
  if (!refSha) {
    // Rule 2: never silently fall back to the default branch.
    return {
      ...OK_UNSCOPED,
      requested: true,
      error: {
        code: "REF_NOT_FOUND",
        status: 404,
        message: `No branch, tag or commit named "${rawRef}" in this repository.`,
      },
    };
  }
  return { error: null, scope: { ref: rawRef, refSha, subPath }, pinSha: refSha, requested: true };
}
