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
import { basename, dirname, join } from "node:path";
import { runGit } from "@/lib/local/git";

export interface LoopWorktree {
  /** The temp checkout the agent works in. */
  dir: string;
  /** The new branch the run's commits land on — the deliverable. */
  branch: string;
  /** The operator's paired working copy the worktree hangs off (needed to remove it again). */
  pairedPath: string;
}

/**
 * A branch stamp shared by every lane of one run, so the run's branches read as a set.
 *
 * SECONDS, not minutes — `slice(0, 12)` (`YYYYMMDDHHmm`) was the resolution until 2026-08-29, and a
 * DRIVE is precisely the thing that defeats it: it dispatches its runs back to back, so run 2 of a
 * drive lands in the same clock minute as run 1, asks for a branch name that already exists, and the
 * lane dies with `fatal: a branch named '…' already exists` before it ever gets a worktree. Measured
 * in the L2 certification (uat/runs/2026-08-29-loop-l2): a 2-run drive on one repo took 12 seconds
 * end to end and its second run produced nothing.
 *
 * The reason that is worse than an ordinary lane error is what the DRIVE then concludes. Zero
 * commits means zero debt movement, `driveVerdict` reads that as `dry` — "a whole run moved nothing,
 * so the drive stopped rather than spend the rest of its rope proving it again" — and the operator is
 * told her repository plateaued when in fact the run never started. An infrastructure failure was
 * being reported as a finding about her code.
 *
 * Seconds close it for the drive; `createLoopWorktree`'s collision suffix closes the class.
 */
export function runStamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
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
  const base = branchFor(repo, stamp);
  const dir = await mkdtemp(join(tmpdir(), "ascent-loop-"));
  // A NAME COLLISION IS NOT A FAILURE — it is the same repo getting a second run inside one stamp
  // tick, and the right answer is the next name, not a dead lane. Only the "already exists" refusal
  // is retried: every other git failure (a corrupt repo, a missing HEAD, no disk) still throws on the
  // first attempt, because retrying those would just produce the same error N times more slowly.
  let branch = base;
  let added = await runGit(pairedPath, ["worktree", "add", "-b", branch, dir, "HEAD"]);
  for (let n = 2; !added.ok && BRANCH_EXISTS.test(added.stderr || added.stdout) && n <= BRANCH_SUFFIX_CAP; n += 1) {
    branch = `${base}-${n}`;
    added = await runGit(pairedPath, ["worktree", "add", "-b", branch, dir, "HEAD"]);
  }
  if (!added.ok) {
    await rm(dir, { recursive: true, force: true }).catch(() => null);
    throw new Error(`Could not create the worktree for ${repo}: ${added.stderr || added.stdout}`);
  }
  return { dir, branch, pairedPath };
}

/** git's own refusal when `-b <name>` names an existing branch. */
const BRANCH_EXISTS = /a branch named .* already exists/i;
/** How many suffixed names to try. Small on purpose: past a handful, something else is wrong. */
const BRANCH_SUFFIX_CAP = 20;

/** Best-effort teardown of the temp checkout. The branch is deliberately left behind. */
export async function removeLoopWorktree(wt: LoopWorktree): Promise<void> {
  await runGit(wt.pairedPath, ["worktree", "remove", "--force", wt.dir]).catch(() => null);
  await rm(wt.dir, { recursive: true, force: true }).catch(() => null);
}

// ── the worktrees a KILLED lane leaves behind ───────────────────────────────────────────────────
//
// `removeLoopWorktree` runs in the lane's `finally`, which a `taskkill /F` never reaches. The boot
// sweep reconciles database rows and nothing on the filesystem, so every hard kill strands a temp
// checkout: the L2 certification left 3 (~15 MB each) and found 4 more on the operator's machine from
// three days earlier, which is the accumulation this predicts. Finding L2-C-02.
//
// The sweep is driven from the BRANCH, not from a directory listing of `%TEMP%`. A branch name is
// unique to one lane of one run, so "belonging to a run the sweep just stopped" is a fact git can be
// asked rather than one a filename pattern guesses at — and a worktree belonging to a run that is
// still live can never match, because a live run is not in the set. The `%TEMP%` + `ascent-loop-*` shape
// is then checked as a SECOND condition before anything is deleted, not as the first one.

/** One stopped lane, as the sweep needs it: which repo's checkout, on which branch. */
export interface StrandedLane {
  orgSlug: string;
  repoFullName: string;
  branch: string;
}

/** One entry of `git worktree list --porcelain`. */
export interface WorktreeEntry {
  dir: string;
  /** The checked-out branch, short form, or null for a detached worktree. */
  branch: string | null;
}

/** Parse `git worktree list --porcelain`: blank-line-separated blocks of `<key> <value>` lines. */
const LINE_SPLIT = /\r?\n/;
const BACKSLASHES = /\\/g;
const TRAILING_SLASHES = /\/+$/;

export function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = [];
  let dir: string | null = null;
  let branch: string | null = null;
  const flush = () => {
    if (dir) out.push({ dir, branch });
    dir = null;
    branch = null;
  };
  for (const raw of stdout.split(LINE_SPLIT)) {
    const line = raw.trim();
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      dir = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  flush();
  return out;
}

const normalize = (p: string): string => p.replace(BACKSLASHES, "/").replace(TRAILING_SLASHES, "").toLowerCase();

/**
 * Is this a directory THIS module made? The second condition, and the one that makes the removal
 * safe: `createLoopWorktree` calls `mkdtemp(join(tmpdir(), "ascent-loop-"))`, so a worktree it made is
 * always a direct child of the temp root with that prefix. An operator who paired a repo whose own
 * checkout happens to sit on a matching branch is therefore untouched.
 */
export function isLoopTempWorktree(dir: string, tempRoot: string): boolean {
  return normalize(dirname(dir)) === normalize(tempRoot) && basename(dir).startsWith("ascent-loop-");
}

export interface StrandedSweepDeps {
  /** The operator's working copy for a repo — the checkout the worktree hangs off. */
  pairedPath: (orgSlug: string, repoFullName: string) => Promise<string | null>;
  tempRoot: () => string;
}

/**
 * Remove the temp checkouts belonging to the given (already-stopped) lanes. Best-effort throughout:
 * a repo that cannot be read, a worktree that will not remove, or a pairing that has since been
 * cleared each skip to the next one. Returns the directories actually removed.
 *
 * The BRANCH is deliberately left alone, exactly as `removeLoopWorktree` leaves it: it is the
 * deliverable, and a killed run's partial branch is still something the operator may want to read.
 */
export async function removeStrandedWorktrees(lanes: readonly StrandedLane[], deps: StrandedSweepDeps): Promise<string[]> {
  const byRepo = new Map<string, { orgSlug: string; repoFullName: string; branches: Set<string> }>();
  for (const lane of lanes) {
    const key = `${lane.orgSlug}::${lane.repoFullName}`;
    const entry = byRepo.get(key) ?? { orgSlug: lane.orgSlug, repoFullName: lane.repoFullName, branches: new Set<string>() };
    entry.branches.add(lane.branch);
    byRepo.set(key, entry);
  }

  const tempRoot = deps.tempRoot();
  const removed: string[] = [];
  for (const { orgSlug, repoFullName, branches } of byRepo.values()) {
    const paired = await deps.pairedPath(orgSlug, repoFullName).catch(() => null);
    if (!paired) continue;
    const listed = await runGit(paired, ["worktree", "list", "--porcelain"]);
    if (!listed.ok) continue;
    for (const entry of parseWorktreeList(listed.stdout)) {
      if (!entry.branch || !branches.has(entry.branch)) continue;
      if (!isLoopTempWorktree(entry.dir, tempRoot)) continue;
      await runGit(paired, ["worktree", "remove", "--force", entry.dir]).catch(() => null);
      await rm(entry.dir, { recursive: true, force: true }).catch(() => null);
      removed.push(entry.dir);
    }
    // Clears the administrative files for worktrees whose directory a previous sweep (or the
    // operator) already deleted by hand — the other half of the leak L2-C-02 describes.
    if (removed.length > 0) await runGit(paired, ["worktree", "prune"]).catch(() => null);
  }
  return removed;
}
