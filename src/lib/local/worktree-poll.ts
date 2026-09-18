// THE WORKTREE, read while the agent works — corroboration for the stream, and the ONLY live signal for
// an executor that does not stream (spark theater-upgrade, 2026-09-18; WP4 implements).
//
// Every `WORKTREE_POLL_MS` during the agent stage: `git diff --stat` (and the untracked list) in the
// lane's worktree → the lane's diff stat and edited files, plus a `heartbeatAt` stamp when anything
// changed since the last poll. Never overlaps itself (a slow git call skips the next tick), never throws,
// and the returned stop function clears every timer it armed.

/** Start polling. Returns the stop function. STUB (WP0): nothing is armed. */
export function startWorktreePoll(_dir: string, _laneId: string): () => void {
  return () => {};
}
