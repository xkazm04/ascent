import { type AppRepo, type RepoState } from "./installationRepoTypes";

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
