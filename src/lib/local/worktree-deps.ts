// MAKING A LANE WORKTREE RUNNABLE — the dependency caches a `git worktree` cannot give it.
//
// THE DEFECT THIS EXISTS FOR. `createLoopWorktree` makes a git worktree, and a git worktree contains
// exactly the TRACKED files of a commit. Dependencies are gitignored, so a fresh lane worktree has no
// `node_modules` — and `npm run test:unit` there does not fail, it cannot start. The first live outing
// of the A/B degradation guard resolved each of two real repositories' own commands correctly and then
// returned `baseline-red` (now `baseline-unavailable`) for BOTH, on the pristine tree, before the agent had touched anything. A red
// baseline is never compared against, so the guard protected nothing, and the lane brief's promise
// that "structural changes are safe, the lane verifies them" was hollow for precisely the repositories
// it was written for. Every JavaScript/TypeScript repo would have reported `baseline-unavailable` forever.
//
// THE FIX IS A LINK, NEVER A COPY. Copying `node_modules` is minutes and gigabytes per lane, per arm,
// per run; a directory link is one syscall. On Windows the link is a JUNCTION (`fs.symlink(target,
// path, "junction")`), which — unlike a Windows symlink — needs no elevation and no Developer Mode.
// Elsewhere it is an ordinary directory symlink. This is the same technique that made three throwaway
// worktrees runnable by hand earlier in this session; it is not a novel trick.
//
// A LINK MEANS WRITES REACH THE OPERATOR'S REAL DIRECTORY. Anything the lane writes under a linked
// name lands in the paired checkout, not in the throwaway worktree. That is acceptable for a
// dependency/build CACHE — a package manager's install directory is derived state the operator can
// rebuild with one command — and it is unacceptable for anything else. So the list below is
// dependency caches ONLY: never source, never config, never `.git`, never `.env`, never a data
// directory. A name is added here only if losing it or having it mutated is a `npm ci` away from
// repaired.
//
// TWO CONDITIONS BEFORE ANY LINK IS MADE, and the second is what keeps the scan honest:
//   1. The name is a real directory in the SOURCE checkout, and does not already exist in the
//      worktree. A `vendor/` that a Go repo COMMITS is already there as tracked content; linking over
//      it is both impossible and wrong.
//   2. The worktree's own git says the name is IGNORED (`git check-ignore`). The rescan lists a lane's
//      files with `git ls-files -c -o --exclude-standard` (`LocalFsSource`), which drops ignored
//      paths — measured, not assumed: with `node_modules/` in `.gitignore` a junction is invisible to
//      that listing, while a plain `git ls-files -o` walks straight into it. So "ignored" is exactly
//      the property that guarantees a linked cache cannot enter the scan's file census and skew a
//      score. A repository that does not ignore its own dependency directory gets no link and a note
//      saying why, rather than a silently inflated tree.
//
// BEST-EFFORT, NEVER FATAL. A permission error, a filesystem with no symlinks, a target that vanished
// between the stat and the symlink — each is a note on the lane and the next name. A lane that could
// not link its dependencies still runs; it simply verifies as `baseline-unavailable` or `skipped` the way it
// did before this module existed.

import { lstat, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { runGit } from "@/lib/local/git";

/**
 * The dependency/build caches worth linking, and why this list and not a longer one.
 *
 * Each entry is (a) derived state a package manager rebuilds from a lockfile, (b) conventionally
 * gitignored, and (c) large enough that copying it per lane would dominate the run. Nothing here
 * carries authored content, so the "writes reach the operator's directory" property above is a cache
 * mutation rather than a data loss.
 *
 *   node_modules — npm / pnpm / yarn. The case that produced the defect: every JS/TS repository.
 *   .venv, venv  — the two conventional Python virtualenv names (PEP 405 layout, `python -m venv`).
 *   vendor       — Go `vendor/`, Ruby bundler's `vendor/bundle`, PHP composer's `vendor/`. Frequently
 *                  COMMITTED in Go, which condition 1 already handles: it is then tracked content
 *                  already present in the worktree and is left alone.
 *
 * Deliberately absent: `.next`, `target`, `build`, `dist` — build OUTPUT, which a lane is expected to
 * regenerate and which a link would let one lane's build stomp on another's. `.git`, `.env*` and any
 * config or data directory are absent for the reason in the header: they are not caches.
 */
export const LINKABLE_DEPENDENCY_DIRS: readonly string[] = ["node_modules", ".venv", "venv", "vendor"];

/** A junction on Windows (no elevation, no Developer Mode); a plain directory symlink elsewhere. */
const LINK_TYPE: "junction" | "dir" = process.platform === "win32" ? "junction" : "dir";

export interface DependencyLinks {
  /** The names actually linked into the worktree. */
  linked: string[];
  /** Operator-facing lines for the lane log — the successes in one line, then one line per refusal. */
  notes: string[];
}

const exists = (p: string): Promise<boolean> => lstat(p).then(() => true, () => false);

/**
 * Link `sourceDir`'s dependency caches into `worktreeDir`. Never throws.
 *
 * Returns what was linked and what to say about it. A name the source checkout does not have is not
 * mentioned at all — most repositories use one ecosystem, and a note per absent name would be noise
 * that buries the one refusal that matters.
 */
export async function linkDependencyDirs(
  sourceDir: string,
  worktreeDir: string,
  names: readonly string[] = LINKABLE_DEPENDENCY_DIRS,
): Promise<DependencyLinks> {
  const linked: string[] = [];
  const notes: string[] = [];
  for (const name of names) {
    const target = join(sourceDir, name);
    const info = await stat(target).catch(() => null);
    if (!info?.isDirectory()) continue; // this repository does not use that ecosystem — silence, not a note
    const link = join(worktreeDir, name);
    if (await exists(link)) continue; // tracked content (a committed `vendor/`), already in the checkout
    // TRAILING SLASH, and it is load-bearing. `check-ignore` cannot know that a path which does not
    // exist yet is a DIRECTORY, and the conventional pattern `node_modules/` is directory-only:
    // measured, `check-ignore -q -- node_modules` answers "not ignored" on a fresh worktree while
    // `check-ignore -q -- node_modules/` answers "ignored". Getting this wrong would silently disable
    // every link. Exit 0 = ignored; 1 = not ignored; 128 = git could not answer — the last two are
    // both "do not link", because the census guarantee has to be proven, not assumed.
    const ignored = await runGit(worktreeDir, ["check-ignore", "-q", "--", `${name}/`]);
    if (!ignored.ok) {
      notes.push(
        `Did not link \`${name}\` into this lane's worktree: the repository does not ignore it, so linking it would ` +
          `put the paired checkout's files into the lane's own file census and move its score for a reason that is not a change.`,
      );
      continue;
    }
    try {
      await symlink(target, link, LINK_TYPE);
      linked.push(name);
    } catch (err) {
      notes.push(
        `Could not link \`${name}\` into this lane's worktree (${err instanceof Error ? err.message : String(err)}). ` +
          `The lane still runs; its verification may report \`baseline-unavailable\` — the repository's own command cannot start in this worktree, which is not a claim about the repository.`,
      );
    }
  }
  if (linked.length > 0) {
    notes.unshift(
      `Linked ${linked.map((n) => `\`${n}\``).join(", ")} from the paired checkout so this worktree can run the repository's own checks. ` +
        `These are links, not copies — writes under them reach the operator's real directory, which is why only dependency caches are linked.`,
    );
  }
  return { linked, notes };
}

/**
 * Remove the dependency LINKS from a worktree, without ever following one into the operator's
 * directory. Returns the names removed. Never throws.
 *
 * TWO INDEPENDENT GUARANTEES, because this is the one function in the change that could destroy a
 * user's `node_modules`:
 *   • It removes a path ONLY when that path's own `lstat` says it is a link. A real directory in the
 *     worktree — a committed `vendor/`, a `node_modules` some lane genuinely installed — is never
 *     touched here; `git worktree remove` deals with those.
 *   • `fs.rm` is called WITHOUT `recursive`, so there is no code path by which it can walk into the
 *     target. It can only unlink the single entry it was handed. (Verified on Windows: a non-recursive
 *     `rm` on a junction removes the junction and leaves the target's contents intact.)
 *
 * It takes the full candidate list rather than a record of what was linked, so the boot sweep can
 * clean a STRANDED worktree — one whose lane was hard-killed and whose `LoopWorktree` is long gone.
 */
export async function unlinkDependencyDirs(
  worktreeDir: string,
  names: readonly string[] = LINKABLE_DEPENDENCY_DIRS,
): Promise<string[]> {
  const removed: string[] = [];
  for (const name of names) {
    const link = join(worktreeDir, name);
    const info = await lstat(link).catch(() => null);
    if (!info?.isSymbolicLink()) continue;
    const ok = await rm(link, { force: true }).then(() => true, () => false);
    if (ok) removed.push(name);
  }
  return removed;
}
