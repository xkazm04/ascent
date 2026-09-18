// THE RUNNER BRANCH — where unattended work ACCUMULATES, so each run builds on the last
// (spark theater-upgrade, 2026-09-18; WP2 implements).
//
// One long-lived branch per repo (`RUNNER_BRANCH`), never checked out in the operator's working copy.
//   • ensure   — create it from the base branch when absent.
//   • mergeIn  — merge the base INTO the runner branch inside a TEMP worktree (merge, never rebase: lane
//                SHAs are recorded on rows, and rewriting them orphans the ledger). A conflict aborts the
//                merge and reports the files; the runner pauses that repo (`branch-conflict`).
//   • land     — fast-forward the runner branch to a lane's tip with `update-ref <ref> <new> <old>` (the
//                old-value guard refuses a race). A non-fast-forward is refused, never forced.
//   • mergeOut — the ledger's "Merge runner into <base>": fast-forward `update-ref` when the base is not
//                checked out; `merge --ff-only` when it is checked out AND clean; otherwise the exact
//                commands for the operator (a human-performed step, never a forced write into a dirty tree).
// Every git call is bounded (git.ts `runGit`) and every function RESOLVES — a git failure is data.

export interface RunnerBranchResult {
  ok: boolean;
  /** One sentence for the lane log / the ledger. */
  note: string;
  sha?: string | null;
}

/** The branch a repo's runner merges in from and back into. STUB (WP0): unresolved. */
export async function resolveBaseBranch(_pairedPath: string): Promise<string | null> {
  return null;
}

/** Create the runner branch at the base's tip when it does not exist. STUB (WP0). */
export async function ensureRunnerBranch(_pairedPath: string, _baseBranch: string): Promise<RunnerBranchResult> {
  return { ok: false, note: "Runner branches are not built yet." };
}

export type MergeInResult =
  | { ok: true; note: string; sha: string | null; changed: boolean }
  | { ok: false; conflict: boolean; files: string[]; note: string };

/** Merge the base into the runner branch in a temp worktree. STUB (WP0). */
export async function mergeInBase(_pairedPath: string, _baseBranch: string): Promise<MergeInResult> {
  return { ok: false, conflict: false, files: [], note: "Runner branches are not built yet." };
}

/** Fast-forward the runner branch to `laneBranch`'s tip. STUB (WP0). */
export async function landOnRunner(_pairedPath: string, _laneBranch: string): Promise<RunnerBranchResult> {
  return { ok: false, note: "Runner branches are not built yet." };
}

export type MergeOutResult =
  | { ok: true; outcome: "fast-forward" | "merged"; mergedSha: string | null; note: string }
  | { ok: false; outcome: "commands"; commands: string[]; note: string };

/** Bring the runner branch into the base. STUB (WP0): hands back the commands. */
export async function mergeRunnerInto(_pairedPath: string, baseBranch: string): Promise<MergeOutResult> {
  return {
    ok: false,
    outcome: "commands",
    commands: [`git switch ${baseBranch}`, "git merge --ff-only ascent/runner"],
    note: "Runner branches are not built yet.",
  };
}

/** Commits on the runner branch not on the base. STUB (WP0): unknown. */
export async function runnerAheadCount(_pairedPath: string, _baseBranch: string): Promise<number | null> {
  return null;
}
