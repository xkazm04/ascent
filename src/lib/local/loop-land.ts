// LANDING — fast-forward a finished lane's branch into the branch the operator's paired checkout is
// actually standing on.
//
// THE RULE IS `--ff-only`, AND IT IS THE WHOLE SAFETY STORY. The lane's branch was cut from that very
// HEAD moments earlier (`createLoopWorktree` does `worktree add -b <branch> <tmp> HEAD`), so a clean
// lane IS a fast-forward. If it is not — the checkout moved on, two lanes raced, an A/B run produced
// two branches for one repo — then landing would mean resolving somebody's tree for them, and this
// module refuses instead. That refusal is also the honest signal that two runs collided.
//
// WHAT IT NEVER DOES, in order of how bad it would be:
//   • never `checkout` / `switch` — the operator's branch is theirs, and a loop that moves it is a
//     loop nobody can leave running,
//   • never `reset`, never `stash` — a dirty file is a STOP SIGN, not an obstacle to clear,
//   • never a remote: no fetch, no push, no upstream. Landing is a purely local merge.
//
// And a refusal is not a run failure. The lane's work is still on its branch, exactly where `branch`
// mode would have left it; the operator is told why on the lane log and in a lesson candidate.

import { runGit, type GitResult } from "@/lib/local/git";

/** Why a land did not happen, in a SMALL closed vocabulary. The lane log gets the full sentence (with
 *  branch names and shas); the lesson candidate gets one of these, so a campaign that refuses the
 *  same way fifty times produces one review row rather than fifty. */
export type LandRefusal = "detached" | "diverged" | "uncommitted" | "already" | "git-failed";

export interface LandOutcome {
  landed: boolean;
  /** The one line the lane log carries — full detail, including branch names and shas. */
  reason: string;
  /** The stable cause, for the lesson. Null exactly when `landed` is true. */
  refusal: LandRefusal | null;
  /** The branch the checkout was on, when it could be read. */
  into?: string;
  /** Short shas either side of the merge. Present only on a successful land. */
  from?: string;
  to?: string;
}

export interface LandDeps {
  git: (cwd: string, args: readonly string[]) => Promise<GitResult>;
}

export const defaultLandDeps: LandDeps = { git: (cwd, args) => runGit(cwd, args) };

const firstLine = (r: GitResult): string => (r.stderr || r.stdout).split("\n").find((l) => l.trim()) ?? "git gave no reason";

/**
 * The paths `git status --porcelain` reports as changed, INCLUDING untracked ones.
 *
 * Untracked files count: git refuses a merge that would overwrite an untracked working-tree file for
 * the same reason it refuses one that would overwrite a modified tracked file, and both are the
 * operator's work. Renames arrive as `R  old -> new`; both halves are the operator's.
 */
export function dirtyPaths(porcelain: string): string[] {
  const out = new Set<string>();
  for (const raw of porcelain.split(/\r?\n/)) {
    if (raw.trim() === "") continue;
    const body = raw.slice(3).trim();
    if (body === "") continue;
    for (const half of body.split(" -> ")) {
      const p = half.trim().replace(/^"(.*)"$/, "$1");
      if (p) out.add(p);
    }
  }
  return [...out];
}

/** The paths a merge of `branch` would write, from `git diff --name-only HEAD..branch`. */
export const changedPaths = (nameOnly: string): string[] =>
  nameOnly.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/**
 * Fast-forward `branch` into whatever `pairedPath` currently has checked out.
 *
 * Never throws: every failure is an outcome with a reason, because a land that cannot happen is
 * information for the operator, not an exception that should unwind a run whose real work is already
 * committed and safe on the branch.
 */
export async function landLaneBranch(pairedPath: string, branch: string, deps: LandDeps = defaultLandDeps): Promise<LandOutcome> {
  const { git } = deps;

  const headRef = await git(pairedPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!headRef.ok) {
    return { landed: false, refusal: "git-failed", reason: `Could not read the checkout's current branch: ${firstLine(headRef)}` };
  }
  const into = headRef.stdout.trim();
  // A detached HEAD is not a branch, so "land into my current branch" has no answer. `merge --ff-only`
  // would happily move the detached HEAD and leave the operator's work referenced by nothing.
  if (into === "" || into === "HEAD") {
    return {
      landed: false,
      refusal: "detached",
      reason: `Not landing ${branch}: the paired checkout is on a detached HEAD, so there is no branch to land into.`,
    };
  }

  const ahead = await git(pairedPath, ["rev-list", "--count", `HEAD..${branch}`]);
  if (!ahead.ok) {
    return { landed: false, into, refusal: "git-failed", reason: `Could not compare ${branch} with ${into}: ${firstLine(ahead)}` };
  }
  if (Number(ahead.stdout.trim()) === 0) {
    // Already contained — which is what a second land of the same branch looks like, and is a no-op
    // rather than a problem. Idempotent by construction, exactly like the campaign harness's pass.
    return { landed: false, into, refusal: "already", reason: `${branch} is already contained in ${into} — nothing to land.` };
  }

  const behind = await git(pairedPath, ["rev-list", "--count", `${branch}..HEAD`]);
  if (!behind.ok) {
    return { landed: false, into, refusal: "git-failed", reason: `Could not compare ${into} with ${branch}: ${firstLine(behind)}` };
  }
  if (Number(behind.stdout.trim()) > 0) {
    return {
      landed: false,
      into,
      refusal: "diverged",
      reason: `Not landing ${branch}: ${into} has ${behind.stdout.trim()} commit(s) ${branch} does not, so this is no longer a fast-forward. The lane's work is on its branch — merge it yourself.`,
    };
  }

  // THE DIRTY-FILE STOP, checked BEFORE the merge rather than relying on git's own refusal. Both
  // catch it; doing it here means the reason names the file, and it means the merge command is never
  // issued against a tree the operator is mid-edit in.
  const status = await git(pairedPath, ["status", "--porcelain"]);
  const incoming = await git(pairedPath, ["diff", "--name-only", `HEAD..${branch}`]);
  if (status.ok && incoming.ok) {
    const dirty = new Set(dirtyPaths(status.stdout));
    const clash = changedPaths(incoming.stdout).filter((p) => dirty.has(p));
    if (clash.length > 0) {
      return {
        landed: false,
        into,
        refusal: "uncommitted",
        reason: `Not landing ${branch}: it would overwrite ${clash.length} file(s) you have uncommitted changes in (${clash.slice(0, 3).join(", ")}${clash.length > 3 ? ", …" : ""}). Nothing was touched.`,
      };
    }
  }

  const before = await git(pairedPath, ["rev-parse", "--short", "HEAD"]);
  const merged = await git(pairedPath, ["merge", "--ff-only", branch]);
  if (!merged.ok) {
    return {
      landed: false,
      into,
      refusal: "git-failed",
      reason: `Could not land ${branch} into ${into}: ${firstLine(merged)}. Nothing was changed.`,
    };
  }
  const after = await git(pairedPath, ["rev-parse", "--short", "HEAD"]);
  return {
    landed: true,
    into,
    refusal: null,
    from: before.stdout.trim(),
    to: after.stdout.trim(),
    reason: `Landed ${branch} into ${into} (${before.stdout.trim()}..${after.stdout.trim()}), fast-forward only.`,
  };
}
