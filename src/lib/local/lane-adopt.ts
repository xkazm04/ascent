// ADOPTING HELD WORK — what an approved held plan lands (challenge-2026-09-23, card live-war-room#B).
//
// When the fence holds a lane (lane-plan-fence.ts), the cycle's finished commits are parked on
// `ascent/held/<planId>` and a new pending plan asks the operator about them. Approving that plan used
// to throw the commits away in practice: the directed lane opened a FRESH agent session and re-derived
// the work, paying for a second session whose output nobody had been shown. Registry
// `hitl-approval/resume-after-decision`: whatever runs after an approval that was not what was shown is
// unapproved by definition. So:
//
//   • `adoptHeldCommits` cherry-picks the held commits the lane does not already carry (`HEAD..<held>` —
//     the lane is cut from the runner branch, so that is exactly `ascent/runner..<held>`, the range the
//     reviewer was shown) onto the directed lane's worktree. A conflict, an empty range, a missing
//     branch or a dirty tree is REFUSED with a reason, and the worktree is left where it was — the lane
//     then falls back to today's fresh session. The world is still re-validated after adoption: the
//     guard, the integrity check and the rescan run on what landed, unchanged.
//   • `readHeldDiff` is the reviewer's evidence, read where they decide: the commit count and each
//     file's added/deleted lines, `git diff --numstat ascent/runner...<held>` in the paired checkout.
//
// A held branch is never deleted here: a refused or reversed adoption loses nothing.
// Every git call is bounded (git.ts `runGit`) and every function RESOLVES — a git failure is data.

import { runGit, type GitResult } from "@/lib/local/git";
import { HELD_BRANCH_PREFIX } from "@/lib/local/lane-plan-fence";
import { RUNNER_BRANCH } from "@/lib/local/runner-types";

/** A cherry-pick over a real repository's files is seconds, not the 15 s a read gets. */
const ADOPT_TIMEOUT_MS = 2 * 60_000;

/**
 * Only a ref the fence could have written is ever handed to git. The name comes off a database row,
 * and a row is not a place argv should trust: this refuses an option-shaped string, a `..` walk out of
 * the held namespace, and anything that is not `ascent/held/<safe>`.
 */
export function isHeldBranchName(name: string): boolean {
  if (!name.startsWith(HELD_BRANCH_PREFIX)) return false;
  const rest = name.slice(HELD_BRANCH_PREFIX.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rest) && !rest.includes("..") && !rest.endsWith(".lock");
}

export type AdoptResult = { ok: true; commits: number } | { ok: false; reason: string };

export interface AdoptInput {
  /** The directed lane's throwaway worktree. */
  dir: string;
  /** The approved plan's held branch. */
  heldBranch: string;
}

const why = (r: GitResult): string => (r.stderr || r.stdout).split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 200) || "git gave no reason";

/** The files a failed cherry-pick names as conflicted, for the reason the lane log carries. */
function conflictsIn(r: GitResult): string[] {
  const out: string[] = [];
  for (const line of `${r.stdout}\n${r.stderr}`.split(/\r?\n/)) {
    const m = /^CONFLICT \([^)]*\): .*?(?:in|deleted in) (\S+)/.exec(line.trim());
    if (m?.[1] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Cherry-pick the held commits onto the lane, or refuse and leave the worktree exactly where it was. */
export async function adoptHeldCommits(input: AdoptInput): Promise<AdoptResult> {
  const { dir, heldBranch } = input;
  if (!isHeldBranchName(heldBranch)) return { ok: false, reason: `\`${heldBranch.slice(0, 80)}\` is not a held branch` };
  const exists = await runGit(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${heldBranch}^{commit}`]);
  if (!exists.ok || !exists.stdout.trim()) return { ok: false, reason: `the held branch ${heldBranch} no longer exists` };
  const head = await runGit(dir, ["rev-parse", "HEAD"]);
  if (!head.ok) return { ok: false, reason: `the lane's HEAD could not be read (${why(head)})` };
  const before = head.stdout.trim();
  const range = `${before}..refs/heads/${heldBranch}`;
  const count = await runGit(dir, ["rev-list", "--count", range]);
  const n = count.ok ? Number(count.stdout.trim()) || 0 : 0;
  if (!count.ok) return { ok: false, reason: `the held range could not be counted (${why(count)})` };
  if (n === 0) return { ok: false, reason: `${heldBranch} carries no commit this lane does not already have` };
  const status = await runGit(dir, ["status", "--porcelain"]);
  if (!status.ok || status.stdout.trim()) return { ok: false, reason: "the lane's worktree is not clean, so nothing was applied to it" };

  const picked = await runGit(dir, ["cherry-pick", range], { timeoutMs: ADOPT_TIMEOUT_MS });
  if (picked.ok) {
    const landed = await runGit(dir, ["rev-list", "--count", `${before}..HEAD`]);
    return { ok: true, commits: landed.ok ? Number(landed.stdout.trim()) || n : n };
  }
  // REFUSED: put the worktree back exactly where it was. `--abort` restores HEAD and the index; the
  // reset is the belt for a cherry-pick that stopped part-way through a multi-commit range.
  await runGit(dir, ["cherry-pick", "--abort"]);
  const after = await runGit(dir, ["rev-parse", "HEAD"]);
  if (!after.ok || after.stdout.trim() !== before) await runGit(dir, ["reset", "--hard", before]);
  const files = conflictsIn(picked);
  return {
    ok: false,
    reason: files.length > 0
      ? `cherry-picking ${heldBranch} onto the lane conflicted in ${files.join(", ")}, so it was aborted`
      : `cherry-picking ${heldBranch} onto the lane failed (${why(picked)}), so it was aborted`,
  };
}

// ── THE REVIEWER'S VIEW ─────────────────────────────────────────────────────────────────────────

export interface HeldDiffFile {
  path: string;
  /** Null for a binary file, which numstat cannot count in lines. */
  added: number | null;
  deleted: number | null;
}

/** What `GET /api/org/loop/plans/[id]` answers for a held plan. */
export interface HeldDiff {
  heldBranch: string;
  commits: number;
  files: HeldDiffFile[];
}

/** `git diff --numstat -z --no-renames` output → one row per file. */
export function parseNumstat(stdout: string): HeldDiffFile[] {
  const out: HeldDiffFile[] = [];
  for (const rec of stdout.split("\0")) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(rec.replace(/^\r?\n/, ""));
    if (!m) continue;
    out.push({ path: m[3]!, added: m[1] === "-" ? null : Number(m[1]), deleted: m[2] === "-" ? null : Number(m[2]) });
  }
  return out;
}

/** The held branch's commits and per-file line counts against the runner branch, in the paired checkout. */
export async function readHeldDiff(
  pairedPath: string,
  heldBranch: string,
): Promise<{ ok: true; diff: HeldDiff } | { ok: false; reason: string }> {
  if (!isHeldBranchName(heldBranch)) return { ok: false, reason: "not a held branch" };
  const held = `refs/heads/${heldBranch}`;
  const count = await runGit(pairedPath, ["rev-list", "--count", `${RUNNER_BRANCH}..${held}`]);
  if (!count.ok) return { ok: false, reason: why(count) };
  const diff = await runGit(pairedPath, ["-c", "core.quotepath=off", "diff", "--numstat", "-z", "--no-renames", `${RUNNER_BRANCH}...${held}`]);
  if (!diff.ok) return { ok: false, reason: why(diff) };
  return { ok: true, diff: { heldBranch, commits: Number(count.stdout.trim()) || 0, files: parseNumstat(diff.stdout) } };
}
