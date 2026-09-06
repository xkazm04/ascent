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
import { linkDependencyDirs, unlinkDependencyDirs } from "@/lib/local/worktree-deps";

export interface LoopWorktree {
  /** The temp checkout the agent works in. */
  dir: string;
  /** The new branch the run's commits land on — the deliverable. */
  branch: string;
  /** The operator's paired working copy the worktree hangs off (needed to remove it again). */
  pairedPath: string;
  /** Dependency caches linked in from `pairedPath` so the checkout can actually RUN (worktree-deps.ts). */
  linkedDeps: string[];
  /** What to say about that linking, drained onto the lane log once by `takeDepNotes`. */
  depNotes: string[];
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

/** The loop's branch prefix. Other lanes (a registry dispatch) pass their own; the fold is shared. */
export const LOOP_BRANCH_PREFIX = "ascent/loop-";

/** Branch names are git refs, not free text: fold "owner/name" to a single safe segment. */
export function branchNameFor(repo: string, stamp: string, prefix: string = LOOP_BRANCH_PREFIX): string {
  const slug = repo.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "repo";
  return `${prefix}${stamp}-${slug}`;
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
  let added = await runGit(pairedPath, ["worktree", "add", "-b", branch, dir, "HEAD"], { timeoutMs: WORKTREE_GIT_TIMEOUT_MS });
  for (let n = 2; !added.ok && BRANCH_EXISTS.test(added.stderr || added.stdout) && n <= BRANCH_SUFFIX_CAP; n += 1) {
    branch = `${base}-${n}`;
    added = await runGit(pairedPath, ["worktree", "add", "-b", branch, dir, "HEAD"], { timeoutMs: WORKTREE_GIT_TIMEOUT_MS });
  }
  if (!added.ok) {
    // No links exist yet on this path — they are made below, only after the add succeeded — so a
    // recursive delete here cannot reach anything of the operator's.
    await rm(dir, { recursive: true, force: true }).catch(() => null);
    throw new Error(`Could not create the worktree for ${repo}: ${added.stderr || added.stdout}`);
  }
  // A WORKTREE IS TRACKED FILES ONLY, so it arrives with no `node_modules` and the repository's own
  // `npm run test:unit` cannot start in it — which is how the degradation guard came to report
  // `baseline-red` on two pristine repositories on its first live run. Link the paired checkout's
  // dependency caches in. Best-effort by contract: `linkDependencyDirs` never throws, and a lane that
  // links nothing behaves exactly as every lane did before this existed.
  const deps = await linkDependencyDirs(pairedPath, dir).catch(() => ({ linked: [], notes: [] }));
  return { dir, branch, pairedPath, linkedDeps: deps.linked, depNotes: deps.notes };
}

/**
 * Take the worktree's linking notes for the lane log, leaving it empty.
 *
 * Drained rather than read because the linking happens ONCE per worktree while a worktree is worked
 * by several cycles: the first lane to open it says what was linked, and cycle 2 does not repeat it.
 */
export function takeDepNotes(wt: LoopWorktree): string[] {
  // A worktree from a test double (or an older caller) carries no array; a missing one is "nothing to
  // say", never a throw on the lane's happy path.
  const notes = wt.depNotes as string[] | undefined;
  return notes ? notes.splice(0) : [];
}

// A worktree add is a full checkout (kp: 3,249 files; systedo: 2,701) and a remove walks it back.
// The default GIT_TIMEOUT_MS (15 s) fits a ref lookup, not a checkout: under disk contention — a
// full build and test suite running beside the loop — both campaign repos hit the cap at
// "Updating files: 4%", the hard-resolve abandoned them, and a whole campaign produced nothing.
// Five minutes is the budget a checkout of this size honestly needs; the watchdog above it still
// bounds the cycle as a whole.
const WORKTREE_GIT_TIMEOUT_MS = 5 * 60_000;
/** git's own refusal when `-b <name>` names an existing branch. */
const BRANCH_EXISTS = /a branch named .* already exists/i;
/** How many suffixed names to try. Small on purpose: past a handful, something else is wrong. */
const BRANCH_SUFFIX_CAP = 20;

/**
 * Best-effort teardown of the temp checkout. The branch is deliberately left behind.
 *
 * THE ORDER IS A SAFETY PROPERTY, NOT A STYLE CHOICE. `git worktree remove --force` FOLLOWS a
 * junction: measured on Windows, removing a worktree that still contained a junction to the paired
 * checkout's `node_modules` deleted the paired checkout's `node_modules` — the operator's real
 * directory, not the link. So the links come out FIRST, through `unlinkDependencyDirs`, which removes
 * only paths whose own `lstat` says they are links and calls `fs.rm` without `recursive` so it cannot
 * walk into a target. By the time git is asked to remove anything there is no link left to follow.
 *
 * The trailing `rm(dir, { recursive: true })` is the fallback for a worktree git refused to remove.
 * It runs after the unlink for the same reason — though Node's recursive remove is itself junction-
 * safe (it unlinks a reparse point rather than descending into it), the guarantee should not rest on
 * a second implementation's behaviour when ordering makes it moot.
 */
export async function removeLoopWorktree(wt: LoopWorktree): Promise<void> {
  await unlinkDependencyDirs(wt.dir).catch(() => []);
  await runGit(wt.pairedPath, ["worktree", "remove", "--force", wt.dir], { timeoutMs: WORKTREE_GIT_TIMEOUT_MS }).catch(() => null);
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
      // SAME ORDER, SAME REASON as `removeLoopWorktree`, and it matters more here: a hard-killed lane
      // never reached its `finally`, so a stranded worktree is exactly the case that still HAS its
      // dependency links, and `worktree remove --force` follows a junction into the operator's own
      // `node_modules`. The links come out first, by lstat, non-recursively.
      await unlinkDependencyDirs(entry.dir).catch(() => []);
      await runGit(paired, ["worktree", "remove", "--force", entry.dir], { timeoutMs: WORKTREE_GIT_TIMEOUT_MS }).catch(() => null);
      await rm(entry.dir, { recursive: true, force: true }).catch(() => null);
      removed.push(entry.dir);
    }
    // Clears the administrative files for worktrees whose directory a previous sweep (or the
    // operator) already deleted by hand — the other half of the leak L2-C-02 describes.
    if (removed.length > 0) await runGit(paired, ["worktree", "prune"]).catch(() => null);
  }
  return removed;
}
