// A LINK IS REMOVED, NEVER FOLLOWED — the helpers the dependency lane and the teardown use, proven
// against the real filesystem and real git, because every claim here is about what the OS and git do
// with a junction (Windows) or a directory symlink (elsewhere). A mock would agree with anything.
//
// The shape of every safety test below: a REAL directory holding a marker file stands in for the
// operator's checkout's `node_modules`; it is linked into a temp worktree; the operation runs; and the
// assertion is that the TARGET directory and its marker still exist.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoopWorktree, removeLoopWorktree } from "./loop-worktree";
import { isLinkedWorktree, relinkDependency, removeInstalledDependencyTrees, unlinkDependencyLink } from "./worktree-deps";

const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";
let root: string;

/** A real directory with a marker — the operator's `node_modules`, as far as these tests are concerned. */
function precious(name = "precious"): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "leftpad"), { recursive: true });
  writeFileSync(join(dir, "MARKER.txt"), "the operator's real directory\n", "utf8");
  writeFileSync(join(dir, "leftpad", "index.js"), "module.exports = 1;\n", "utf8");
  return dir;
}
const intact = (dir: string) => existsSync(join(dir, "MARKER.txt")) && existsSync(join(dir, "leftpad", "index.js"));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ascent-links-test-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("unlinkDependencyLink", () => {
  it("removes the LINK and leaves the target directory and its marker intact", async () => {
    const target = precious();
    const wt = join(root, "wt");
    mkdirSync(wt);
    symlinkSync(target, join(wt, "node_modules"), LINK_TYPE);

    const out = await unlinkDependencyLink(wt, "node_modules");

    expect(out.outcome).toBe("removed");
    expect(out.target?.replace(/\\/g, "/").toLowerCase()).toContain("precious");
    expect(existsSync(join(wt, "node_modules"))).toBe(false);
    expect(intact(target)).toBe(true);
  });

  it("leaves a REAL directory alone, and says so", async () => {
    const wt = join(root, "wt");
    mkdirSync(join(wt, "node_modules"), { recursive: true });
    writeFileSync(join(wt, "node_modules", "own.txt"), "installed here\n", "utf8");

    expect(await unlinkDependencyLink(wt, "node_modules")).toEqual({ outcome: "not-a-link", target: null });
    expect(existsSync(join(wt, "node_modules", "own.txt"))).toBe(true);
  });

  it("reports nothing there as absent", async () => {
    expect(await unlinkDependencyLink(root, "node_modules")).toEqual({ outcome: "absent", target: null });
  });
});

describe("relinkDependency", () => {
  it("puts the link back to the same target, reachable through it", async () => {
    const target = precious();
    const wt = join(root, "wt");
    mkdirSync(wt);
    expect(await relinkDependency(wt, target)).toBe(true);
    expect(lstatSync(join(wt, "node_modules")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(wt, "node_modules", "MARKER.txt"), "utf8")).toContain("real directory");
  });

  it("never links over anything, and never to a target that is not a directory", async () => {
    const target = precious();
    const wt = join(root, "wt");
    mkdirSync(join(wt, "node_modules"), { recursive: true });
    expect(await relinkDependency(wt, target)).toBe(false);
    expect(lstatSync(join(wt, "node_modules")).isSymbolicLink()).toBe(false);
    rmSync(join(wt, "node_modules"), { recursive: true });
    expect(await relinkDependency(wt, join(root, "does-not-exist"))).toBe(false);
    expect(existsSync(join(wt, "node_modules"))).toBe(false);
  });
});

describe("what the platform does with a link inside a real tree", () => {
  it("Node's recursive rm UNLINKS a nested link instead of following it (the failure path relies on it)", async () => {
    const target = precious();
    const tree = join(root, "tree");
    mkdirSync(join(tree, "pkg"), { recursive: true });
    symlinkSync(target, join(tree, "pkg", "file-dep"), LINK_TYPE);
    await rm(tree, { recursive: true, force: true });
    expect(existsSync(tree)).toBe(false);
    expect(intact(target)).toBe(true);
  });
});

describe("removeInstalledDependencyTrees + the teardown", () => {
  let repo: string;
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  beforeEach(() => {
    repo = join(root, "repo");
    mkdirSync(repo);
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n", "utf8");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "fixture" }), "utf8");
    git(repo, "init", "-b", "main");
    git(repo, "config", "user.email", "links-test@ascent.invalid");
    git(repo, "config", "user.name", "Links Test");
    git(repo, "config", "commit.gpgsign", "false");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "chore: fixture");
  });

  /** A worktree whose `node_modules` an install turned into a REAL tree holding a link that leaves it. */
  async function installedWorktree(outside: string) {
    const wt = await createLoopWorktree(repo, "acme/api", `2026091812${Math.floor(Math.random() * 9000 + 1000)}`);
    mkdirSync(join(wt.dir, "node_modules", "real-pkg"), { recursive: true });
    writeFileSync(join(wt.dir, "node_modules", "real-pkg", "index.js"), "1\n", "utf8");
    symlinkSync(outside, join(wt.dir, "node_modules", "file-dep"), LINK_TYPE);
    mkdirSync(join(wt.dir, "packages", "a", "node_modules"), { recursive: true });
    symlinkSync(outside, join(wt.dir, "packages", "a", "node_modules", "file-dep"), LINK_TYPE);
    return wt;
  }

  it("clears every installed node_modules tree in a LINKED worktree without reaching through its links", async () => {
    const outside = precious("outside");
    const wt = await installedWorktree(outside);
    try {
      expect(await isLinkedWorktree(wt.dir)).toBe(true);
      const removed = await removeInstalledDependencyTrees(wt.dir);
      expect(removed.sort()).toEqual(["node_modules", "packages/a/node_modules"]);
      expect(existsSync(join(wt.dir, "node_modules"))).toBe(false);
      expect(intact(outside)).toBe(true);
    } finally {
      await removeLoopWorktree(wt);
    }
  });

  it("the TEARDOWN of a worktree an install filled leaves what its links point at intact", async () => {
    // Without the tree removal, `git worktree remove --force` follows `node_modules/file-dep` (a
    // junction on Windows) and deletes `outside`'s contents — measured before this was written.
    const outside = precious("outside");
    const wt = await installedWorktree(outside);
    await removeLoopWorktree(wt);
    expect(existsSync(wt.dir)).toBe(false);
    expect(intact(outside)).toBe(true);
  });

  it("never touches a MAIN checkout's node_modules — only a linked worktree qualifies", async () => {
    mkdirSync(join(repo, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "dep", "index.js"), "1\n", "utf8");
    expect(await isLinkedWorktree(repo)).toBe(false);
    expect(await removeInstalledDependencyTrees(repo)).toEqual([]);
    expect(existsSync(join(repo, "node_modules", "dep", "index.js"))).toBe(true);
  });
});
