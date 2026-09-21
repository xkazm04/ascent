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

import { appendFile, lstat, mkdir, readFile, readlink, rm, rmdir, stat, symlink, unlink } from "node:fs/promises";
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
/**
 * THE LINK WE CREATE IS A FILE TO GIT, AND THE CONVENTIONAL IGNORE PATTERN IS DIRECTORY-ONLY.
 *
 * `node_modules/` — the pattern essentially every repository ships — matches a DIRECTORY. On Windows
 * the link is a junction, which the filesystem reports as a directory, so the pattern matches and the
 * link is invisible to git. On POSIX it is a symlink, which git classifies as a FILE, so the same
 * pattern does not match and the link surfaces as an untracked entry in the lane's file census —
 * inflating the worktree rescan's file count against the before-scan it is compared to, which is the
 * exact harm the check above exists to prevent. The directory-form proof was measured on Windows and
 * silently did not carry.
 *
 * The repair keeps the census driven by git's own ignore machinery (see the header of
 * `src/lib/local/source.ts`: excluded "by the repo's own ignore rules rather than by a second,
 * drifting list here") by making git ignore the FILE form too — in the one place git actually reads a
 * repo-local exclude for a worktree, which is measured, not assumed: a linked worktree's OWN
 * `$GIT_DIR/info/exclude` is NOT consulted; `$GIT_COMMON_DIR/info/exclude` is.
 *
 * That file belongs to the operator's checkout, so the write is fenced hard:
 *   - only ever a name this module is about to link, which it has ALREADY proven the repository
 *     ignores in directory form — so the line cannot hide anything the repo was not already hiding;
 *   - never committed and never pushed (`info/exclude` is repo-local by construction);
 *   - idempotent, and best-effort: a failure returns false and the caller declines to link, exactly
 *     as it declines for a repository that does not ignore the directory at all.
 */
async function ensureIgnoredAsFile(worktreeDir: string, name: string): Promise<boolean> {
  // Already ignored in the form we are about to create (a junction host, or a repo whose pattern has
  // no trailing slash) — nothing to write.
  if ((await runGit(worktreeDir, ["check-ignore", "-q", "--", name])).ok) return true;

  const common = await runGit(worktreeDir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok) return false;
  const excludePath = join(common.stdout.trim(), "info", "exclude");
  try {
    const existing = await readFile(excludePath, "utf8").catch(() => "");
    if (!existing.split(/\r?\n/).some((line) => line.trim() === name)) {
      await mkdir(join(common.stdout.trim(), "info"), { recursive: true });
      await appendFile(
        excludePath,
        `${existing.endsWith("\n") || existing === "" ? "" : "\n"}# ascent: the lane worktree links this as a symlink, which the repo's directory-only pattern misses\n${name}\n`,
        "utf8",
      );
    }
  } catch {
    return false;
  }
  // Prove it, rather than assume the write took.
  return (await runGit(worktreeDir, ["check-ignore", "-q", "--", name])).ok;
}

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
    // …and then the FILE form, because that is what a symlink is to git. See `ensureIgnoredAsFile`.
    if (ignored.ok && !(await ensureIgnoredAsFile(worktreeDir, name))) {
      notes.push(
        `Did not link \`${name}\` into this lane's worktree: the repository ignores it as a directory but the link ` +
          `itself would show up as an untracked file, which would put the paired checkout into the lane's own file ` +
          `census and move its score for a reason that is not a change.`,
      );
      continue;
    }
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

// ── REMOVING A LINK, RE-MAKING ONE, AND CLEARING A TREE THE ENGINE INSTALLED ────────────────────
//
// Three operations the dependency lane (`lane-deps-install.ts`) and the teardown need, all written to
// ONE rule: nothing here may ever reach THROUGH a link. A link in a lane worktree points into the
// operator's real checkout, and every deletion below is shaped so that the worst it can do is remove
// the link itself. Measured on Windows (Node 24): `fs.unlink` and a non-recursive `fs.rmdir` each
// remove a junction and leave its target's contents intact; `fs.rm({ recursive: true })` unlinks a
// junction it meets — at the top or nested — rather than descending into it; and `git worktree remove
// --force` does NOT: it follows a junction nested inside a real `node_modules` and deletes what it
// points at. Each of those is pinned by a test in `worktree-deps.links.test.ts`.

/** The one dependency directory the ENGINE ever installs into (`lane-deps-install.ts`). */
export const ENGINE_INSTALL_DIR = "node_modules";

export interface UnlinkedDependency {
  /** `removed` — the link is gone, its target untouched; `absent` — nothing was there; `not-a-link` —
   *  a real directory or file, deliberately left alone; `failed` — it is still a link. */
  outcome: "removed" | "absent" | "not-a-link" | "failed";
  /** Where the link pointed (for `relinkDependency`), when it was a link and could be read. */
  target: string | null;
}

/** Two removers, neither of which can recurse. `unlink` removes a POSIX symlink and — on Windows — a
 *  junction or a directory symlink; `rmdir` WITHOUT `recursive` is the fallback for a Windows junction
 *  a Node build refuses to unlink (EPERM/EISDIR). On POSIX `rmdir` of a symlink is ENOTDIR: harmless. */
const LINK_REMOVERS: readonly ((path: string) => Promise<void>)[] = [(p) => unlink(p), (p) => rmdir(p)];

/**
 * Remove ONE dependency link — the link itself, never what it points at. Never throws.
 *
 * `lstat` decides, never `stat`: a real directory (or file) under the name is `not-a-link` and is not
 * touched at all. After each remover the path is `lstat`ed again, so `removed` is observed, not
 * assumed. The target is read BEFORE removal so a caller can put the same link back.
 */
export async function unlinkDependencyLink(worktreeDir: string, name: string = ENGINE_INSTALL_DIR): Promise<UnlinkedDependency> {
  const path = join(worktreeDir, name);
  const info = await lstat(path).catch(() => null);
  if (!info) return { outcome: "absent", target: null };
  if (!info.isSymbolicLink()) return { outcome: "not-a-link", target: null };
  const target = await readlink(path).catch(() => null);
  for (const remove of LINK_REMOVERS) {
    await remove(path).catch(() => undefined);
    const after = await lstat(path).catch(() => null);
    if (!after) return { outcome: "removed", target };
    if (!after.isSymbolicLink()) return { outcome: "failed", target }; // something else appeared — stop
  }
  return { outcome: "failed", target };
}

/**
 * Put a dependency link back the way `linkDependencyDirs` makes one — a junction on Windows, a
 * directory symlink elsewhere. Only onto an EMPTY name (never over anything) and only to a target that
 * is still a real directory. The ignore conditions `linkDependencyDirs` proves are not re-proven: this
 * restores a link that existed moments ago in the same worktree, whose ignore rules (and the
 * `info/exclude` line) are unchanged. Returns whether the link now exists. Never throws.
 */
export async function relinkDependency(worktreeDir: string, target: string, name: string = ENGINE_INSTALL_DIR): Promise<boolean> {
  const link = join(worktreeDir, name);
  if (await exists(link)) return false;
  const info = await stat(target).catch(() => null);
  if (!info?.isDirectory()) return false;
  return symlink(target, link, LINK_TYPE).then(
    () => true,
    () => false,
  );
}

/** Is `dir` a LINKED worktree (its own git dir differs from the common one) — never a main checkout? */
export async function isLinkedWorktree(dir: string): Promise<boolean> {
  const r = await runGit(dir, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]);
  if (!r.ok) return false;
  const [gitDir, common] = r.stdout.split(/\r?\n/).map((s) => s.trim().replace(/\\/g, "/").toLowerCase());
  return Boolean(gitDir && common && gitDir !== common);
}

/**
 * Clear every REAL `node_modules` tree in a lane worktree — what an engine install leaves behind — with
 * Node's recursive remove, which unlinks each link it meets instead of following it. Returns the
 * repo-relative paths removed. Never throws.
 *
 * WHY TEARDOWN NEEDS THIS. Before the engine could install, a lane worktree's `node_modules` was only
 * ever a link, and `unlinkDependencyDirs` removing it was the whole safety story. An install makes it a
 * real tree, and a real tree can hold links of its own — a `file:` dependency, a workspace package, a
 * pnpm store entry — some pointing OUTSIDE the worktree. `git worktree remove --force` follows those
 * (measured), so the tree has to be gone before git is asked to remove anything.
 *
 * Fenced twice: only in a LINKED worktree (a main checkout's own `node_modules` can never be reached
 * from here), and only paths git itself reports as ignored-and-untracked whose last segment is
 * `node_modules`.
 */
export async function removeInstalledDependencyTrees(worktreeDir: string): Promise<string[]> {
  if (!(await isLinkedWorktree(worktreeDir))) return [];
  const listed = await runGit(worktreeDir, ["ls-files", "-o", "-i", "--exclude-standard", "--directory", "-z"]);
  if (!listed.ok) return [];
  const removed: string[] = [];
  for (const entry of listed.stdout.split("\0")) {
    const rel = entry.replace(/\/+$/, "");
    const segments = rel.split("/");
    if (!rel || segments[segments.length - 1] !== ENGINE_INSTALL_DIR) continue;
    const path = join(worktreeDir, ...segments);
    const info = await lstat(path).catch(() => null);
    if (!info) continue;
    if (info.isSymbolicLink()) {
      if ((await unlinkDependencyLink(join(worktreeDir, ...segments.slice(0, -1)))).outcome === "removed") removed.push(rel);
      continue;
    }
    if (!info.isDirectory()) continue;
    const ok = await rm(path, { recursive: true, force: true, maxRetries: 3 }).then(
      () => true,
      () => false,
    );
    if (ok) removed.push(rel);
  }
  return removed;
}

/**
 * Remove the dependency LINKS from a worktree, without ever following one into the operator's
 * directory — then clear any `node_modules` tree the engine installed. Returns the LINK names removed.
 * Never throws. Called by the teardown (`removeLoopWorktree`, the stranded sweep) immediately before
 * `git worktree remove --force`.
 *
 * THE GUARANTEES, because this is the one function that could destroy a user's `node_modules`:
 *   • A link is removed ONLY when that path's own `lstat` says it is one, and only by the two
 *     non-recursive removers in `unlinkDependencyLink` — no code path can walk into the target.
 *   • A real directory under a linkable name — a committed `vendor/` — is never touched here. The one
 *     exception is a real `node_modules` in a LINKED worktree, which only an engine install (or a
 *     repository that commits its dependency tree, into a checkout about to be deleted) put there; it
 *     is cleared by `removeInstalledDependencyTrees` so that git does not follow the links inside it.
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
    if ((await unlinkDependencyLink(worktreeDir, name)).outcome === "removed") removed.push(name);
  }
  await removeInstalledDependencyTrees(worktreeDir).catch(() => []);
  return removed;
}
