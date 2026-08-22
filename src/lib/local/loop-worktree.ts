// Worktree isolation for a loop run's lanes — the guardrail that makes an unattended editing agent
// safe to run on a machine someone works on.
//
// `git worktree add -b <branch> <tmp> HEAD` gives each repo in a run its own checkout on its own new
// branch: the agent never touches the operator's working copy, their branch, or their uncommitted
// changes. ONE worktree per repo per RUN (not per cycle) — cycles build on each other's commits
// exactly like a human working a branch, and one branch is one reviewable deliverable.
//
// The BRANCH survives the run. That IS the output: review it, merge it. Only the temp directory is
// removed, with --force, because an agent may leave untracked scratch behind and a stranded temp dir
// would outlive every run that made one.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit } from "@/lib/local/git";

export interface LoopWorktree {
  /** The temp checkout the agent works in. */
  dir: string;
  /** The new branch the run's commits land on — the deliverable. */
  branch: string;
  /** The operator's paired working copy the worktree hangs off (needed to remove it again). */
  pairedPath: string;
}

/** A branch stamp shared by every lane of one run, so the run's branches read as a set. */
export function runStamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:T]/g, "").slice(0, 12);
}

/** Branch names are git refs, not free text: fold "owner/name" to a single safe segment. */
export function branchNameFor(repo: string, stamp: string): string {
  const slug = repo.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "repo";
  return `ascent/loop-${stamp}-${slug}`;
}

export async function createLoopWorktree(
  pairedPath: string,
  repo: string,
  stamp: string,
  /** Overrides the branch name — the autopilot shim keeps its historical `ascent/autopilot-<stamp>`. */
  branchFor: (repo: string, stamp: string) => string = branchNameFor,
): Promise<LoopWorktree> {
  const branch = branchFor(repo, stamp);
  const dir = await mkdtemp(join(tmpdir(), "ascent-loop-"));
  const added = await runGit(pairedPath, ["worktree", "add", "-b", branch, dir, "HEAD"]);
  if (!added.ok) {
    await rm(dir, { recursive: true, force: true }).catch(() => null);
    throw new Error(`Could not create the worktree for ${repo}: ${added.stderr || added.stdout}`);
  }
  return { dir, branch, pairedPath };
}

/** Best-effort teardown of the temp checkout. The branch is deliberately left behind. */
export async function removeLoopWorktree(wt: LoopWorktree): Promise<void> {
  await runGit(wt.pairedPath, ["worktree", "remove", "--force", wt.dir]).catch(() => null);
  await rm(wt.dir, { recursive: true, force: true }).catch(() => null);
}
