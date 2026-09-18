// ONE REAL INSTALL, end to end and offline: a lane worktree whose session added a local `file:`
// dependency gets a real `npm install --ignore-scripts`, and then the real teardown.
//
// What only a real npm can prove:
//   • scripts are OFF — both the dependency's `postinstall` and the repository's own would drop a
//     marker file if they ran, and neither may exist afterwards;
//   • the lockfile the install writes lands in the worktree (so the lane's commit carries it);
//   • npm links a `file:` directory dependency — a JUNCTION on Windows pointing OUTSIDE the worktree —
//     and the teardown must remove the worktree without following it into that directory.
// No registry is contacted: the only dependency is a local directory, `npm_config_offline` is set,
// and the npm cache is a temp directory of the test's own.

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoopWorktree, removeLoopWorktree, type LoopWorktree } from "./loop-worktree";
import { installChangedDependencies } from "./lane-deps-install";

const npmAvailable = (() => {
  try {
    execSync("npm --version", { encoding: "utf8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
/** A lifecycle script that proves it ran by leaving a file behind. */
const marker = (file: string) => `node -e "require('fs').writeFileSync('${file}','ran')"`;

let root: string;
let wt: LoopWorktree | null = null;
const saved = { offline: process.env.npm_config_offline, cache: process.env.npm_config_cache };

afterEach(async () => {
  if (wt) await removeLoopWorktree(wt).catch(() => null);
  wt = null;
  process.env.npm_config_offline = saved.offline;
  process.env.npm_config_cache = saved.cache;
  if (saved.offline === undefined) delete process.env.npm_config_offline;
  if (saved.cache === undefined) delete process.env.npm_config_cache;
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe.skipIf(!npmAvailable)("a real dependency lane (npm, offline)", () => {
  it("installs with scripts off, writes the lockfile in the worktree, and tears down without following the link", async () => {
    root = mkdtempSync(join(tmpdir(), "ascent-deps-e2e-"));
    const depSrc = join(root, "tiny-dep");
    mkdirSync(depSrc);
    writeFileSync(join(depSrc, "package.json"), JSON.stringify({ name: "tiny-dep", version: "1.0.0", scripts: { postinstall: marker("DEP_SCRIPT_RAN") } }), "utf8");
    writeFileSync(join(depSrc, "index.js"), "module.exports = 42;\n", "utf8");

    const repo = join(root, "repo");
    mkdirSync(repo);
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n", "utf8");
    const manifest = { name: "fixture", version: "1.0.0", private: true, scripts: { postinstall: marker("ROOT_SCRIPT_RAN") } };
    writeFileSync(join(repo, "package.json"), JSON.stringify(manifest, null, 2), "utf8");
    git(repo, "init", "-b", "main");
    git(repo, "config", "user.email", "deps-e2e@ascent.invalid");
    git(repo, "config", "user.name", "Deps E2E");
    git(repo, "config", "commit.gpgsign", "false");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "chore: fixture");
    mkdirSync(join(repo, "node_modules", "leftpad"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "PRECIOUS.txt"), "the operator's real directory\n", "utf8");

    wt = await createLoopWorktree(repo, "acme/api", "20260918120000");
    expect(wt.linkedDeps).toContain("node_modules");
    const before = git(wt.dir, "rev-parse", "HEAD");
    // THE SESSION'S EDIT: a new dependency, and no lockfile update (the agent has no shell to make one).
    const depSpec = `file:${depSrc.replace(/\\/g, "/")}`;
    writeFileSync(join(wt.dir, "package.json"), JSON.stringify({ ...manifest, dependencies: { "tiny-dep": depSpec } }, null, 2), "utf8");

    process.env.npm_config_offline = "true";
    process.env.npm_config_cache = join(root, "npm-cache");
    const out = await installChangedDependencies({ dir: wt.dir, before, laneId: "lane-e2e", timeoutMs: 180_000 });

    expect(out).toMatchObject({ changed: true, ok: true, manager: "npm" });
    expect(lstatSync(join(wt.dir, "node_modules")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(wt.dir, "node_modules", "tiny-dep", "index.js"), "utf8")).toContain("42");
    expect(readFileSync(join(wt.dir, "package-lock.json"), "utf8")).toContain("tiny-dep");
    expect(git(wt.dir, "status", "--porcelain")).toContain("package-lock.json");
    // Scripts OFF: neither the dependency's nor the repository's own lifecycle script ran.
    expect(existsSync(join(depSrc, "DEP_SCRIPT_RAN"))).toBe(false);
    expect(existsSync(join(wt.dir, "node_modules", "tiny-dep", "DEP_SCRIPT_RAN"))).toBe(false);
    expect(existsSync(join(wt.dir, "ROOT_SCRIPT_RAN"))).toBe(false);
    // The operator's directory was never written.
    expect(readdirSync(join(repo, "node_modules")).sort()).toEqual(["PRECIOUS.txt", "leftpad"]);

    // THE TEARDOWN: `node_modules/tiny-dep` links OUT of the worktree to `depSrc`. Removing the
    // worktree must not follow it.
    const dir = wt.dir;
    await removeLoopWorktree(wt);
    wt = null;
    expect(existsSync(dir)).toBe(false);
    expect(readFileSync(join(depSrc, "index.js"), "utf8")).toContain("42");
    expect(readdirSync(join(repo, "node_modules")).sort()).toEqual(["PRECIOUS.txt", "leftpad"]);
  }, 240_000);
});
