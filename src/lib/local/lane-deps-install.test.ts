// THE ENGINE INSTALLS A DEPENDENCY LANE'S CHANGE — against a real git repository and a real lane
// worktree (made by `createLoopWorktree`, so the node_modules link is the production one), with the
// package manager replaced by a fake that records its argv and plays the install's effect on disk. No
// network: the one real install lives in `lane-deps-install.e2e.test.ts`.
//
// The invariant every case re-asserts: the paired checkout's `node_modules` — the operator's real
// directory — still holds exactly what it held, whatever the install did.

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoopWorktree, removeLoopWorktree, type LoopWorktree } from "./loop-worktree";
import { commandLine } from "./lane-deps-detect";
import type { SpawnInstall, SpawnResult } from "./lane-deps-spawn";
import { installChangedDependencies } from "./lane-deps-install";

let root: string;
let repo: string;
let wt: LoopWorktree | null = null;
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function setup(opts: { lockfile?: string; ignore?: string } = {}): Promise<{ dir: string; before: string }> {
  root = mkdtempSync(join(tmpdir(), "ascent-depsinstall-test-"));
  repo = join(root, "repo");
  mkdirSync(join(repo, "packages", "a"), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), opts.ignore ?? "node_modules/\n", "utf8");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "fixture", workspaces: ["packages/*"] }), "utf8");
  writeFileSync(join(repo, "packages", "a", "package.json"), JSON.stringify({ name: "a" }), "utf8");
  if (opts.lockfile) writeFileSync(join(repo, opts.lockfile), "# lock\n", "utf8");
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "deps-install@ascent.invalid");
  git(repo, "config", "user.name", "Deps Install");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "chore: fixture");
  // Installed AFTER the commit: the operator's real dependency tree, never tracked.
  mkdirSync(join(repo, "node_modules", "leftpad"), { recursive: true });
  writeFileSync(join(repo, "node_modules", "PRECIOUS.txt"), "the operator's real directory\n", "utf8");
  wt = await createLoopWorktree(repo, "acme/api", `20260918${Math.floor(Math.random() * 900000 + 100000)}`);
  return { dir: wt.dir, before: git(wt.dir, "rev-parse", "HEAD") };
}

afterEach(async () => {
  if (wt) await removeLoopWorktree(wt);
  wt = null;
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const pairedUntouched = () => expect(readdirSync(join(repo, "node_modules")).sort()).toEqual(["PRECIOUS.txt", "leftpad"]);
const ok = (over: Partial<SpawnResult> = {}): SpawnResult => ({ code: 0, output: "", timedOut: false, aborted: false, spawnError: null, ...over });

/** A package manager stand-in: records argv, cwd and whether the link was still there when it ran. */
function fake(effect: (cwd: string, line: string) => SpawnResult = () => ok()) {
  const calls: { line: string; cwd: string; linkAtSpawn: boolean }[] = [];
  const spawn: SpawnInstall = async (cmd, { cwd }) => {
    const line = commandLine(cmd);
    calls.push({ line, cwd, linkAtSpawn: lstatSync(join(cwd, "node_modules"), { throwIfNoEntry: false })?.isSymbolicLink() ?? false });
    return effect(cwd, line);
  };
  return { spawn, calls };
}
/** The disk effect of an install: a real `node_modules` in the worktree with a new package in it. */
const installs = (cwd: string) => mkdirSync(join(cwd, "node_modules", "newdep"), { recursive: true });
const addDependency = (dir: string) =>
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", workspaces: ["packages/*"], dependencies: { newdep: "^1.0.0" } }), "utf8");

describe("detection", () => {
  it("does nothing when no manifest changed, or only another ecosystem's did", async () => {
    const { dir, before } = await setup();
    const f = fake();
    expect(await installChangedDependencies({ dir, before, laneId: "l", timeoutMs: 60_000 }, { spawn: f.spawn })).toEqual({ changed: false });
    writeFileSync(join(dir, "requirements.txt"), "requests==2.32.0\n", "utf8");
    writeFileSync(join(dir, "go.mod"), "module x\n", "utf8");
    expect(await installChangedDependencies({ dir, before, laneId: "l", timeoutMs: 60_000 }, { spawn: f.spawn })).toEqual({ changed: false });
    expect(f.calls).toEqual([]);
    expect(lstatSync(join(dir, "node_modules")).isSymbolicLink()).toBe(true);
  });

  it("never works on a MAIN checkout, even with a changed manifest", async () => {
    await setup();
    addDependency(repo);
    const f = fake();
    expect(await installChangedDependencies({ dir: repo, before: git(repo, "rev-parse", "HEAD"), laneId: "l", timeoutMs: 60_000 }, { spawn: f.spawn })).toEqual({ changed: false });
    expect(f.calls).toEqual([]);
    pairedUntouched();
  });
});

describe("success", () => {
  it("removes the link FIRST, installs in the worktree's own folder, keeps the edit, and never writes the checkout's", async () => {
    const { dir, before } = await setup({ lockfile: "package-lock.json" });
    addDependency(dir);
    const f = fake((cwd) => (installs(cwd), ok()));
    const out = await installChangedDependencies({ dir, before, laneId: "l", timeoutMs: 60_000 }, { spawn: f.spawn });
    expect(out).toEqual({
      changed: true,
      ok: true,
      manager: "npm",
      note: "Installed dependencies for the changed manifest with npm, scripts disabled — the guard verifies against them.",
    });
    expect(f.calls).toEqual([{ line: "npm install --ignore-scripts --no-audit --no-fund", cwd: dir, linkAtSpawn: false }]);
    expect(lstatSync(join(dir, "node_modules")).isSymbolicLink()).toBe(false);
    expect(existsSync(join(dir, "node_modules", "newdep"))).toBe(true);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toContain("newdep");
    pairedUntouched();
  });

  it.each([
    ["pnpm-lock.yaml", null, ["pnpm install --ignore-scripts --no-frozen-lockfile"]],
    ["yarn.lock", "1.22.22", ["yarn --version", "yarn install --ignore-scripts --non-interactive"]],
    ["yarn.lock", "4.5.1", ["yarn --version", "yarn install --mode=skip-build --no-immutable"]],
  ])("root %s (yarn %s) → %j", async (lockfile, yarnVersion, lines) => {
    const { dir, before } = await setup({ lockfile });
    addDependency(dir);
    const f = fake((_cwd, line) => ok({ output: line === "yarn --version" ? `${yarnVersion}\n` : "" }));
    const out = await installChangedDependencies({ dir, before, laneId: "l", timeoutMs: 60_000 }, { spawn: f.spawn });
    expect(out).toMatchObject({ changed: true, ok: true });
    expect(f.calls.map((c) => c.line)).toEqual(lines);
  });

  it("a nested workspace manifest installs at the ROOT, where workspaces resolve", async () => {
    const { dir, before } = await setup();
    writeFileSync(join(dir, "packages", "a", "package.json"), JSON.stringify({ name: "a", dependencies: { newdep: "1" } }), "utf8");
    const f = fake();
    expect(await installChangedDependencies({ dir, before, laneId: "l", timeoutMs: 60_000 }, { spawn: f.spawn })).toMatchObject({ ok: true });
    expect(f.calls[0]!.cwd).toBe(dir);
  });
});

describe("failure — discard the session, clear what the install made, put the link back", () => {
  it("a non-zero exit: edits discarded, junk gone, link restored to the checkout, note quotes the error", async () => {
    const { dir, before } = await setup();
    addDependency(dir);
    writeFileSync(join(dir, "new-module.ts"), "export const x = 1;\n", "utf8");
    const f = fake((cwd) => {
      installs(cwd);
      return ok({ code: 1, output: "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/newdep\n" });
    });
    const out = await installChangedDependencies({ dir, before, laneId: "l", timeoutMs: 60_000 }, { spawn: f.spawn });
    expect(out).toMatchObject({ changed: true, ok: false, manager: "npm" });
    const note = (out as { note: string }).note;
    expect(note).toContain("exited 1 — npm error 404 Not Found");
    expect(note).toContain("paired checkout's dependency folder was not touched");
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(lstatSync(join(dir, "node_modules")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dir, "node_modules", "PRECIOUS.txt"), "utf8")).toContain("real directory");
    pairedUntouched();
  });

  it.each([
    [ok({ code: null, timedOut: true }), "did not finish within 1 min"],
    [ok({ code: null, spawnError: "spawn npm ENOENT" }), "could not run `npm install --ignore-scripts --no-audit --no-fund` (spawn npm ENOENT)"],
  ])("%j → %s", async (result, phrase) => {
    const { dir, before } = await setup();
    addDependency(dir);
    const out = await installChangedDependencies({ dir, before, laneId: "l", timeoutMs: 60_000 }, { spawn: fake(() => result).spawn });
    expect((out as { note: string }).note).toContain(phrase);
    expect(lstatSync(join(dir, "node_modules")).isSymbolicLink()).toBe(true);
    pairedUntouched();
  });

  it("a yarn that cannot even report its version is a failure that names the probe", async () => {
    const { dir, before } = await setup({ lockfile: "yarn.lock" });
    addDependency(dir);
    const f = fake(() => ok({ code: 1, output: "'yarn' is not recognized as an internal or external command," }));
    const out = await installChangedDependencies({ dir, before, laneId: "l", timeoutMs: 60_000 }, { spawn: f.spawn });
    expect((out as { note: string }).note).toContain("`yarn --version` exited 1 — 'yarn' is not recognized");
    expect(f.calls).toHaveLength(1);
    expect(lstatSync(join(dir, "node_modules")).isSymbolicLink()).toBe(true);
  });

  it("an ABORTED lane is never re-linked — its worktree may be on its way to git's teardown", async () => {
    const { dir, before } = await setup();
    addDependency(dir);
    const out = await installChangedDependencies({ dir, before, laneId: "l", timeoutMs: 60_000 }, { spawn: fake((cwd) => (installs(cwd), ok({ code: null, aborted: true }))).spawn });
    expect(out).toMatchObject({ changed: true, ok: false });
    expect(existsSync(join(dir, "node_modules"))).toBe(false);
    pairedUntouched();
  });

  it("a repository that does not ignore node_modules is held BEFORE anything is installed", async () => {
    const { dir, before } = await setup({ ignore: "dist/\n" });
    addDependency(dir);
    const f = fake();
    const out = await installChangedDependencies({ dir, before, laneId: "l", timeoutMs: 60_000 }, { spawn: f.spawn });
    expect((out as { note: string }).note).toContain("does not ignore node_modules/");
    expect(f.calls).toEqual([]);
    expect(git(dir, "status", "--porcelain")).toBe("");
    pairedUntouched();
  });
});
