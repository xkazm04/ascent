import { type AppRepo, type RepoState, type Visibility } from "./installationRepoTypes";

// Pure next-state transforms behind the component's `patch(fullName, next)` helper. The optimistic
// update and its rollback are the SAME underlying array transform (only the `next` payload differs):
// map over the repos, and for the row whose `fullName` matches, merge `next` onto a defaulted RepoState
// (`{ watched:false, scanSchedule:"off", level:null, overall:null, ...r.state, ...next }`). Siblings are
// returned by reference (identity preserved); an absent `fullName` is a no-op. Extracted from
// InstallationRepos.tsx so the watch/schedule optimistic-then-rollback logic is unit-testable in node
// (no jsdom): a regression dropping the non-2xx rollback would otherwise show success theater (a repo the
// UI claims is watched but the server never saved → its scheduled scans silently never run).

/**
 * Apply `next` to the repo identified by `fullName`, mirroring the component's inline `patch` transform.
 * Returns a new array; the matched row is a new object, every other row keeps its identity.
 */
export function patchRepoState(repos: AppRepo[], fullName: string, next: Partial<RepoState>): AppRepo[] {
  return repos.map((r) =>
    r.fullName === fullName
      ? { ...r, state: { watched: false, scanSchedule: "off", level: null, overall: null, ...r.state, ...next } }
      : r,
  );
}

/**
 * Optimistic update: flip the repo's watch/schedule fields to the requested value before the server
 * confirms. Identical transform to `patchRepoState` — named for the call site in `toggleWatch`/`changeSchedule`.
 */
export function applyWatchOptimistic(repos: AppRepo[], fullName: string, next: Partial<RepoState>): AppRepo[] {
  return patchRepoState(repos, fullName, next);
}

/**
 * Rollback: restore the EXACT prior watch/schedule value after a non-2xx (or network-error) response,
 * so a failed save can't masquerade as success. Same transform, fed the captured previous value.
 */
export function rollbackWatch(repos: AppRepo[], fullName: string, prev: Partial<RepoState>): AppRepo[] {
  return patchRepoState(repos, fullName, prev);
}

/**
 * The repo filter predicate, extracted VERBATIM from InstallationRepos.tsx's `filtered` useMemo so it's
 * unit-testable in node. Combines a free-text query (matched case-insensitively against `fullName` AND
 * `language`), a tri-state visibility, a `watchedOnly` toggle, and a language dropdown. An empty query
 * matches all; a contradictory filter (e.g. `visibility:"public"` while only private repos exist) matches
 * none. Invariant: `visibility:"public"` never returns a `private:true` repo (and the symmetric private case).
 */
export function filterRepos(
  repos: AppRepo[],
  filters: { query: string; visibility: Visibility; watchedOnly: boolean; language: string },
): AppRepo[] {
  const { query, visibility, watchedOnly, language } = filters;
  const q = query.trim().toLowerCase();
  return repos.filter((r) => {
    if (q && !r.fullName.toLowerCase().includes(q) && !(r.language ?? "").toLowerCase().includes(q)) return false;
    if (visibility === "public" && r.private) return false;
    if (visibility === "private" && !r.private) return false;
    if (watchedOnly && !r.state?.watched) return false;
    if (language !== "all" && r.language !== language) return false;
    return true;
  });
}

/**
 * Bulk-watch partial-failure accounting, extracted from InstallationRepos.tsx's `watchAllFiltered` so the
 * "a 2xx that saved nothing must read as an error" branch is unit-testable. Given the set of repos a bulk
 * request targeted, the server's `failed` list, and whether the response was 2xx, returns which rows to
 * roll back and the message to show. Invariants enforced here:
 *  - `responseOk === false` → every target reverts, kind `"error"` (the route-level failure path).
 *  - a 2xx where every target is in `failed` (`ok === 0`) → kind `"error"` ("none were saved"), NEVER a
 *    "watching 0" false success; reverts exactly the failed subset (= all targets here).
 *  - a 2xx with a partial `failed` → kind `"note"`, success count is `targets.length - failed.length`,
 *    reverting exactly the failed subset.
 *  - the claimed success count is never > 0 when every row failed.
 */
export function summarizeBulkWatch(input: {
  targetFullNames: string[];
  failed: string[];
  responseOk: boolean;
  error?: string;
}): { revertFullNames: string[]; message: { kind: "note" | "error"; text: string } } {
  const { targetFullNames, failed, responseOk, error } = input;
  if (!responseOk) {
    return {
      revertFullNames: [...targetFullNames],
      message: { kind: "error", text: error ?? "Bulk watch failed — not saved." },
    };
  }
  const ok = targetFullNames.length - failed.length;
  // A 2xx whose every row failed is not a success — read it as an error, not a positive "watching 0".
  if (ok === 0) {
    return {
      revertFullNames: [...failed],
      message: {
        kind: "error",
        text: `Couldn't watch any of the ${failed.length} repo${failed.length === 1 ? "" : "s"} — none were saved.`,
      },
    };
  }
  return {
    revertFullNames: [...failed],
    message: {
      kind: "note",
      text: `Now watching ${ok} repo${ok === 1 ? "" : "s"}${failed.length ? ` · ${failed.length} failed` : ""}.`,
    },
  };
}
