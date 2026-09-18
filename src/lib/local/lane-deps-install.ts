// DEPENDENCY LANES — the ENGINE installs, lifecycle scripts off, so an auto-approved dependency change
// can actually be verified (spark theater-upgrade, 2026-09-18; WP5 implements).
//
// A lane's worktree shares the paired checkout's dependency folder through a link (worktree-deps.ts),
// and the agent has no shell. So when a runner lane's session changed a manifest or lockfile, the
// engine (never the agent) replaces the link with the worktree's OWN dependency folder and runs the
// package manager's install with scripts disabled, so the guard's after-check runs against the new
// dependencies and the updated lockfile is committed with the lane. The operator's checkout's
// dependency folder is NEVER written. Accepted by the operator (Q11): the new package's code runs when
// the guard runs the tests.

export interface DepsInstallInput {
  dir: string;
  /** The worktree HEAD before the session — the diff decides whether a manifest changed. */
  before: string;
  laneId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type DepsInstallOutcome =
  /** No manifest or lockfile changed — nothing to do. */
  | { changed: false }
  | { changed: true; ok: true; manager: string; note: string }
  /** The install failed or the ecosystem is unsupported. The implementation has ALREADY discarded the
   *  session's edits in the throwaway worktree; the lane commits nothing and is held with `note`. */
  | { changed: true; ok: false; manager: string | null; note: string };

/** STUB (WP0): nothing changed. */
export async function installChangedDependencies(_input: DepsInstallInput): Promise<DepsInstallOutcome> {
  return { changed: false };
}
