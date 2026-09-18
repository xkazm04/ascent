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
//
// NEVER CHECKED OUT, LITERALLY. Even the merge-in's temp worktree is DETACHED at the runner tip, and the
// result is written back with a compare-and-swap `update-ref`. A branch checked out in a worktree that
// a crash stranded would refuse every later `worktree add` of it — and "never checked out anywhere" is
// the property that lets every write here be a plain ref move with no working copy behind it.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit, type GitResult } from "@/lib/local/git";
import { parseWorktreeList } from "@/lib/local/loop-worktree";
import { RUNNER_BRANCH } from "@/lib/local/runner-types";

export interface RunnerBranchResult {
  ok: boolean;
  /** One sentence for the lane log / the ledger. */
  note: string;
  sha?: string | null;
}

const RUNNER_REF = `refs/heads/${RUNNER_BRANCH}`;
/** A checkout of a real repository is minutes, not seconds (see loop-worktree.ts). */
const CHECKOUT_TIMEOUT_MS = 5 * 60_000;
/** The identity a merge commit falls back to when the repository has none configured. */
const RUNNER_IDENTITY = ["-c", "user.name=Ascent Runner", "-c", "user.email=runner@ascent.invalid"];

const firstLine = (r: GitResult): string => (r.stderr || r.stdout).split(/\r?\n/).find((l) => l.trim())?.trim() ?? "git gave no reason";
const short = (sha: string | null | undefined): string => (sha ?? "").slice(0, 8);
const lines = (s: string): string[] => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** The commit a ref names, or null when it does not resolve. */
async function sha(cwd: string, ref: string): Promise<string | null> {
  const r = await runGit(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return r.ok ? r.stdout.trim() || null : null;
}

/** Is `a` an ancestor of (or equal to) `b`? Null when git could not say. */
async function isAncestor(cwd: string, a: string, b: string): Promise<boolean | null> {
  const r = await runGit(cwd, ["merge-base", "--is-ancestor", a, b]);
  if (r.ok) return true;
  // Exit 1 with no stderr is git's "no"; anything with stderr is a failure to answer.
  return r.stderr.trim() === "" ? false : null;
}

/** The branch a repo's runner merges in from and back into: the remote's default branch (when it
 *  exists locally), else the branch the checkout is on. Null on a detached checkout with no remote. */
export async function resolveBaseBranch(pairedPath: string): Promise<string | null> {
  const remote = await runGit(pairedPath, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const fromRemote = remote.ok ? remote.stdout.trim().replace(/^origin\//, "") : "";
  if (fromRemote && (await sha(pairedPath, `refs/heads/${fromRemote}`))) return fromRemote;
  const head = await runGit(pairedPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const current = head.ok ? head.stdout.trim() : "";
  return current && current !== RUNNER_BRANCH ? current : null;
}

/** Create the runner branch at the base's tip when it does not exist. */
export async function ensureRunnerBranch(pairedPath: string, baseBranch: string): Promise<RunnerBranchResult> {
  const existing = await sha(pairedPath, RUNNER_REF);
  if (existing) return { ok: true, sha: existing, note: `${RUNNER_BRANCH} exists at ${short(existing)}.` };
  const base = await sha(pairedPath, `refs/heads/${baseBranch}`);
  if (!base) return { ok: false, note: `Cannot create ${RUNNER_BRANCH}: the base branch ${baseBranch} does not exist in this checkout.` };
  // `branch --no-track` creates a ref and checks nothing out; it refuses if the name exists (a race).
  const made = await runGit(pairedPath, ["branch", "--no-track", RUNNER_BRANCH, base]);
  if (!made.ok) return { ok: false, note: `Could not create ${RUNNER_BRANCH}: ${firstLine(made)}` };
  return { ok: true, sha: base, note: `Created ${RUNNER_BRANCH} at ${baseBranch} (${short(base)}).` };
}

export type MergeInResult =
  | { ok: true; note: string; sha: string | null; changed: boolean }
  | { ok: false; conflict: boolean; files: string[]; note: string };

/** Move the runner ref from `old` to `next`, refusing if anything else moved it in between. */
async function casRunner(pairedPath: string, next: string, old: string): Promise<GitResult> {
  return runGit(pairedPath, ["update-ref", "-m", "ascent runner", RUNNER_REF, next, old]);
}

/** Merge the base into the runner branch in a temp worktree. */
export async function mergeInBase(pairedPath: string, baseBranch: string): Promise<MergeInResult> {
  const runner = await sha(pairedPath, RUNNER_REF);
  const base = await sha(pairedPath, `refs/heads/${baseBranch}`);
  if (!runner || !base) {
    return { ok: false, conflict: false, files: [], note: `Cannot merge ${baseBranch} into ${RUNNER_BRANCH}: ${!runner ? RUNNER_BRANCH : baseBranch} does not exist.` };
  }
  // Nothing new on the base — the common case, and it needs no checkout at all.
  if (await isAncestor(pairedPath, base, runner)) return { ok: true, changed: false, sha: runner, note: `${RUNNER_BRANCH} already contains ${baseBranch}.` };
  // The runner has nothing of its own (e.g. just merged out): a fast-forward, still no checkout.
  if (await isAncestor(pairedPath, runner, base)) {
    const moved = await casRunner(pairedPath, base, runner);
    return moved.ok
      ? { ok: true, changed: true, sha: base, note: `Fast-forwarded ${RUNNER_BRANCH} to ${baseBranch} (${short(base)}).` }
      : { ok: false, conflict: false, files: [], note: `Could not fast-forward ${RUNNER_BRANCH}: ${firstLine(moved)}` };
  }
  return mergeInWorktree(pairedPath, baseBranch, runner);
}

async function mergeInWorktree(pairedPath: string, baseBranch: string, runner: string): Promise<MergeInResult> {
  const dir = await mkdtemp(join(tmpdir(), "ascent-runner-merge-"));
  try {
    const added = await runGit(pairedPath, ["worktree", "add", "--detach", dir, runner], { timeoutMs: CHECKOUT_TIMEOUT_MS });
    if (!added.ok) return { ok: false, conflict: false, files: [], note: `Could not open a temp worktree to merge ${baseBranch}: ${firstLine(added)}` };
    const who = await runGit(dir, ["config", "user.email"]);
    const identity = who.ok && who.stdout.trim() ? [] : RUNNER_IDENTITY;
    const msg = `Merge ${baseBranch} into ${RUNNER_BRANCH}`;
    const merged = await runGit(dir, [...identity, "merge", "--no-edit", "-m", msg, `refs/heads/${baseBranch}`], { timeoutMs: CHECKOUT_TIMEOUT_MS });
    if (!merged.ok) {
      const unmerged = await runGit(dir, ["diff", "--name-only", "--diff-filter=U"]);
      const files = unmerged.ok ? lines(unmerged.stdout) : [];
      await runGit(dir, ["merge", "--abort"]);
      return files.length > 0
        ? { ok: false, conflict: true, files, note: `Merging ${baseBranch} into ${RUNNER_BRANCH} conflicts in ${files.length} file(s): ${files.slice(0, 5).join(", ")}${files.length > 5 ? ", …" : ""}. The merge was aborted; nothing moved.` }
        : { ok: false, conflict: false, files: [], note: `Could not merge ${baseBranch} into ${RUNNER_BRANCH}: ${firstLine(merged)}. Nothing moved.` };
    }
    const next = await sha(dir, "HEAD");
    if (!next) return { ok: false, conflict: false, files: [], note: `Merged ${baseBranch} but could not read the result. Nothing moved.` };
    const moved = await casRunner(pairedPath, next, runner);
    if (!moved.ok) return { ok: false, conflict: false, files: [], note: `${RUNNER_BRANCH} moved while ${baseBranch} was being merged in (${firstLine(moved)}). Nothing moved.` };
    return { ok: true, changed: true, sha: next, note: `Merged ${baseBranch} into ${RUNNER_BRANCH} (${short(runner)}..${short(next)}).` };
  } finally {
    await runGit(pairedPath, ["worktree", "remove", "--force", dir], { timeoutMs: CHECKOUT_TIMEOUT_MS }).catch(() => null);
    await rm(dir, { recursive: true, force: true }).catch(() => null);
    await runGit(pairedPath, ["worktree", "prune"]).catch(() => null);
  }
}

/** Fast-forward the runner branch to `laneBranch`'s tip. */
export async function landOnRunner(pairedPath: string, laneBranch: string): Promise<RunnerBranchResult> {
  const old = await sha(pairedPath, RUNNER_REF);
  if (!old) return { ok: false, note: `Not landing ${laneBranch}: ${RUNNER_BRANCH} does not exist in this checkout.` };
  const tip = await sha(pairedPath, `refs/heads/${laneBranch}`);
  if (!tip) return { ok: false, note: `Not landing ${laneBranch}: the branch does not exist.` };
  if (await isAncestor(pairedPath, tip, old)) return { ok: false, sha: old, note: `${laneBranch} is already on ${RUNNER_BRANCH} — nothing to land.` };
  const ff = await isAncestor(pairedPath, old, tip);
  if (ff !== true) {
    return {
      ok: false,
      sha: old,
      note:
        ff === false
          ? `Not landing ${laneBranch}: ${RUNNER_BRANCH} moved on (${short(old)}) and the lane is no longer a fast-forward of it. Nothing was forced; the work is on ${laneBranch}.`
          : `Not landing ${laneBranch}: git could not compare it with ${RUNNER_BRANCH}.`,
    };
  }
  const moved = await casRunner(pairedPath, tip, old);
  if (!moved.ok) return { ok: false, sha: old, note: `Not landing ${laneBranch}: ${RUNNER_BRANCH} moved while landing (${firstLine(moved)}). Nothing was forced.` };
  return { ok: true, sha: tip, note: `Landed ${laneBranch} on ${RUNNER_BRANCH} (${short(old)}..${short(tip)}), fast-forward only.` };
}

export type MergeOutResult =
  | { ok: true; outcome: "fast-forward" | "merged"; mergedSha: string | null; note: string }
  | { ok: false; outcome: "commands"; commands: string[]; note: string };

const quote = (p: string): string => `"${p.replace(/"/g, '\\"')}"`;

/** Where `branch` is checked out, if anywhere — the paired checkout or any worktree of it. */
async function checkedOutAt(pairedPath: string, branch: string): Promise<string | null> {
  const listed = await runGit(pairedPath, ["worktree", "list", "--porcelain"]);
  if (!listed.ok) return null;
  return parseWorktreeList(listed.stdout).find((w) => w.branch === branch)?.dir ?? null;
}

/**
 * Bring the runner branch into the base. `fast-forward` = the base ref moved with no working copy
 * touched (it is not checked out); `merged` = `merge --ff-only` in the checkout that has it, which was
 * clean. Anything else is a real merge or a dirty tree, and both are the operator's: the commands.
 */
export async function mergeRunnerInto(pairedPath: string, baseBranch: string): Promise<MergeOutResult> {
  const runner = await sha(pairedPath, RUNNER_REF);
  const base = await sha(pairedPath, `refs/heads/${baseBranch}`);
  if (!runner || !base) {
    return { ok: false, outcome: "commands", commands: [], note: `Cannot merge: ${!runner ? RUNNER_BRANCH : baseBranch} does not exist in this checkout.` };
  }
  if (await isAncestor(pairedPath, runner, base)) return { ok: true, outcome: "fast-forward", mergedSha: base, note: `${baseBranch} already contains ${RUNNER_BRANCH} — nothing to merge.` };
  const ff = (await isAncestor(pairedPath, base, runner)) === true;
  const at = await checkedOutAt(pairedPath, baseBranch);
  const cd = `cd ${quote(at ?? pairedPath)}`;
  if (!ff) {
    const commands = at ? [cd, `git merge ${RUNNER_BRANCH}`] : [cd, `git switch ${baseBranch}`, `git merge ${RUNNER_BRANCH}`];
    return { ok: false, outcome: "commands", commands, note: `${baseBranch} and ${RUNNER_BRANCH} have diverged, so this is a real merge — yours to make and resolve.` };
  }
  if (!at) {
    const moved = await runGit(pairedPath, ["update-ref", "-m", "ascent runner merge-out", `refs/heads/${baseBranch}`, runner, base]);
    return moved.ok
      ? { ok: true, outcome: "fast-forward", mergedSha: runner, note: `Fast-forwarded ${baseBranch} to ${RUNNER_BRANCH} (${short(base)}..${short(runner)}); no working copy was touched.` }
      : { ok: false, outcome: "commands", commands: [cd, `git switch ${baseBranch}`, `git merge --ff-only ${RUNNER_BRANCH}`], note: `Could not move ${baseBranch}: ${firstLine(moved)}` };
  }
  const status = await runGit(at, ["status", "--porcelain", "--untracked-files=no"]);
  if (!status.ok || status.stdout.trim() !== "") {
    return {
      ok: false,
      outcome: "commands",
      commands: [cd, "git status", `git merge --ff-only ${RUNNER_BRANCH}`],
      note: `${baseBranch} is checked out at ${at} with uncommitted changes — commit or set them aside yourself, then fast-forward. Nothing was touched.`,
    };
  }
  const merged = await runGit(at, ["merge", "--ff-only", RUNNER_BRANCH], { timeoutMs: CHECKOUT_TIMEOUT_MS });
  if (!merged.ok) {
    return { ok: false, outcome: "commands", commands: [cd, `git merge --ff-only ${RUNNER_BRANCH}`], note: `git refused the fast-forward: ${firstLine(merged)}. Nothing was changed.` };
  }
  return { ok: true, outcome: "merged", mergedSha: runner, note: `Fast-forwarded ${baseBranch} to ${RUNNER_BRANCH} in ${at} (${short(base)}..${short(runner)}).` };
}

/** Commits on the runner branch not on the base. Null when git could not say. */
export async function runnerAheadCount(pairedPath: string, baseBranch: string): Promise<number | null> {
  const r = await runGit(pairedPath, ["rev-list", "--count", `refs/heads/${baseBranch}..${RUNNER_REF}`]);
  const n = r.ok ? Number(r.stdout.trim()) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Where the runner branch points now, or null when it does not exist. */
export const runnerTip = (pairedPath: string): Promise<string | null> => sha(pairedPath, RUNNER_REF);
