// A LANE WORKTREE THAT CAN ACTUALLY RUN — the dependency links, and the one way this change could
// have destroyed an operator's `node_modules`.
//
// REAL GIT AND REAL FILESYSTEM, for the same reason `loop-worktree.test.ts` uses them: every claim
// here is about what git and the OS do with a junction, and a mock would simply agree with whatever
// the code asked for. The critical case — `removeLoopWorktree` must not follow the link — was a live
// hazard, not a hypothetical: with the junction still in place, `git worktree remove --force` deleted
// the SOURCE checkout's `node_modules`, so the test below asserts the target's contents by name.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFsSource } from "./source";
import { createLoopWorktree, removeLoopWorktree, removeStrandedWorktrees } from "./loop-worktree";
import { LINKABLE_DEPENDENCY_DIRS, linkDependencyDirs, unlinkDependencyDirs } from "./worktree-deps";

let repo: string;
const made: Awaited<ReturnType<typeof createLoopWorktree>>[] = [];

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A paired checkout with one tracked file, a `.gitignore`, and (optionally) an installed dep tree. */
function fixture(opts: { deps?: boolean; ignore?: string } = {}): void {
  repo = mkdtempSync(join(tmpdir(), "ascent-deps-test-"));
  writeFileSync(join(repo, "README.md"), "# fixture\n", "utf8");
  writeFileSync(join(repo, ".gitignore"), opts.ignore ?? "node_modules/\ndeps/\n", "utf8");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "node -e 0" } }), "utf8");
  if (opts.deps !== false) {
    mkdirSync(join(repo, "node_modules", "leftpad"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "leftpad", "index.js"), "module.exports = 1;\n", "utf8");
    writeFileSync(join(repo, "node_modules", "PRECIOUS.txt"), "the operator's real directory\n", "utf8");
  }
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "deps-test@ascent.invalid");
  git(repo, "config", "user.name", "Deps Test");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "chore: fixture");
}

/** The target's contents, by name — the assertion that proves nothing followed a link. */
const targetContents = (): string[] => readdirSync(join(repo, "node_modules")).sort();

beforeEach(() => fixture());

afterEach(async () => {
  for (const wt of made.splice(0)) await removeLoopWorktree(wt).catch(() => null);
  rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("linkDependencyDirs", () => {
  it("makes the worktree RUNNABLE: the paired checkout's node_modules is reachable inside it", async () => {
    // The defect this exists for: a git worktree holds TRACKED files only, so it arrives with no
    // dependency tree and the repository's own `npm run test:unit` cannot start — which is how the
    // degradation guard returned `baseline-unavailable` for two pristine repositories on its first live run.
    const wt = await createLoopWorktree(repo, "acme/api", "20260831101010");
    made.push(wt);

    expect(wt.linkedDeps).toContain("node_modules");
    expect(lstatSync(join(wt.dir, "node_modules")).isSymbolicLink()).toBe(true);
    // Reachable THROUGH the link, which is the only property a test runner cares about.
    expect(readFileSync(join(wt.dir, "node_modules", "leftpad", "index.js"), "utf8")).toContain("module.exports");
    expect(wt.depNotes.join(" ")).toContain("Linked `node_modules`");
  });

  it("leaves a source checkout with no dependency directory completely alone", async () => {
    rmSync(repo, { recursive: true, force: true });
    fixture({ deps: false });
    const wt = await createLoopWorktree(repo, "acme/api", "20260831101011");
    made.push(wt);

    expect(wt.linkedDeps).toEqual([]);
    expect(wt.depNotes).toEqual([]); // a name the repo does not use is silence, not a note
    expect(existsSync(join(wt.dir, "node_modules"))).toBe(false);
  });

  it("REFUSES to link a directory the repository does not ignore, and says why", async () => {
    // The census guarantee is that a linked cache is invisible to `git ls-files --exclude-standard`,
    // and "ignored" is exactly the property that makes it so. A repo that does not ignore its own
    // dependency tree gets no link — an inflated file census would move its score for a reason that
    // is not a change.
    rmSync(repo, { recursive: true, force: true });
    fixture({ deps: false, ignore: "# nothing ignored here\n" });
    // Installed AFTER the commit, so it is neither tracked (which would already put it in the
    // worktree) nor ignored — the one shape where a link would leak into the census.
    mkdirSync(join(repo, "node_modules"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "PRECIOUS.txt"), "the operator's real directory\n", "utf8");
    const wt = await createLoopWorktree(repo, "acme/api", "20260831101012");
    made.push(wt);

    expect(wt.linkedDeps).toEqual([]);
    expect(wt.depNotes.join(" ")).toContain("does not ignore it");
    expect(existsSync(join(wt.dir, "node_modules"))).toBe(false);
  });

  it("is BEST-EFFORT: a link that cannot be made is a note on the lane, never a throw", async () => {
    const wt = await createLoopWorktree(repo, "acme/api", "20260831101013");
    made.push(wt);
    // A nested name whose PARENT does not exist in the worktree: the target IS a real directory in
    // the source checkout and git DOES agree it is ignored (`deps/` in the fixture's .gitignore), so
    // both deliberate skips are passed and the refusal happens at `symlink` itself — a genuine
    // filesystem failure, which is what "best-effort" has to survive.
    mkdirSync(join(repo, "deps", "cache"), { recursive: true });
    const res = await linkDependencyDirs(repo, wt.dir, ["deps/cache"]);

    expect(res.linked).toEqual([]);
    expect(res.notes.join(" ")).toContain("Could not link");
    expect(res.notes.join(" ")).toContain("baseline-unavailable");
  });

  it("names only dependency CACHES — never source, config or build output", () => {
    // A link means writes reach the operator's real directory, which is acceptable for derived state
    // a package manager rebuilds and unacceptable for anything else.
    expect([...LINKABLE_DEPENDENCY_DIRS]).toEqual(["node_modules", ".venv", "venv", "vendor"]);
    for (const forbidden of [".git", ".env", "src", "dist", ".next", "build", "target"]) {
      expect(LINKABLE_DEPENDENCY_DIRS).not.toContain(forbidden);
    }
  });
});

describe("the target survives teardown", () => {
  it("removeLoopWorktree removes the LINK and leaves the operator's directory intact", async () => {
    // THE CRITICAL TEST. Measured before the fix: `git worktree remove --force` FOLLOWS a junction,
    // and removing a worktree that still held one deleted the source checkout's `node_modules`. The
    // links therefore come out first, by lstat, non-recursively.
    const wt = await createLoopWorktree(repo, "acme/api", "20260831101014");
    expect(wt.linkedDeps).toContain("node_modules");

    await removeLoopWorktree(wt);

    expect(existsSync(wt.dir)).toBe(false);
    expect(targetContents()).toEqual(["PRECIOUS.txt", "leftpad"]);
    expect(readFileSync(join(repo, "node_modules", "leftpad", "index.js"), "utf8")).toContain("module.exports");
  });

  it("the stranded-worktree sweep keeps the same guarantee", async () => {
    // A hard-killed lane never reaches its `finally`, so a stranded worktree is exactly the case that
    // still HAS its links when the boot sweep comes for it.
    const wt = await createLoopWorktree(repo, "acme/api", "20260831101015");
    const removed = await removeStrandedWorktrees([{ orgSlug: "acme", repoFullName: "acme/api", branch: wt.branch }], {
      pairedPath: async () => repo,
      tempRoot: () => tmpdir(),
    });

    // git reports worktree paths with forward slashes; the sweep returns them verbatim.
    expect(removed.map((d) => d.replace(/\\/g, "/"))).toEqual([wt.dir.replace(/\\/g, "/")]);
    expect(existsSync(wt.dir)).toBe(false);
    expect(targetContents()).toEqual(["PRECIOUS.txt", "leftpad"]);
  });

  it("unlinkDependencyDirs never removes a real directory, only a link", async () => {
    const wt = await createLoopWorktree(repo, "acme/api", "20260831101016");
    made.push(wt);
    mkdirSync(join(wt.dir, "vendor"), { recursive: true });
    writeFileSync(join(wt.dir, "vendor", "kept.txt"), "tracked content\n", "utf8");

    expect(await unlinkDependencyDirs(wt.dir)).toEqual(["node_modules"]);
    expect(existsSync(join(wt.dir, "vendor", "kept.txt"))).toBe(true);
    expect(targetContents()).toEqual(["PRECIOUS.txt", "leftpad"]);
  });
});

describe("the scan's file census", () => {
  it("does not see a linked dependency directory", async () => {
    const wt = await createLoopWorktree(repo, "acme/api", "20260831101017");
    made.push(wt);
    expect(wt.linkedDeps).toContain("node_modules");

    // The exact listing `LocalFsSource` runs, then the source itself — a linked tree that leaked into
    // either would inflate the worktree rescan's file count against the before-scan it is compared to.
    const listed = git(wt.dir, "ls-files", "-c", "-o", "--exclude-standard");
    expect(listed.split("\n").sort()).toEqual([".gitignore", "README.md", "package.json"]);

    const snapshot = await new LocalFsSource(wt.dir).fetchSnapshot({ owner: "acme", repo: "api" });
    expect(snapshot.tree.some((f) => f.path.startsWith("node_modules/"))).toBe(false);
    expect(snapshot.tree.map((f) => f.path).sort()).toEqual([".gitignore", "README.md", "package.json"]);
  });
});
