// THE WORKTREES A KILLED LANE LEAVES BEHIND (L2-C-02, 2026-08-29).
//
// `removeLoopWorktree` runs in the lane's `finally`, which a `taskkill /F` never reaches. The L2 run
// left 3 stranded checkouts (~15 MB each) and found 4 more on the operator's machine from three days
// earlier. The boot sweep already knows which runs it just stopped; this is the filesystem half.
//
// The property that matters most here is the NEGATIVE one: a worktree belonging to a branch the sweep
// was not given, or one that is not a `%TEMP%/ascent-loop-*` directory this module made, is not
// touched. Deleting the operator's own checkout would be an unrecoverable bug, so both conditions are
// pinned with real directories.

import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLoopTempWorktree, parseWorktreeList, removeStrandedWorktrees } from "./loop-worktree";

const listed: Record<string, string> = {};
const removeCalls: string[][] = [];

vi.mock("@/lib/local/git", () => ({
  runGit: vi.fn(async (cwd: string, args: readonly string[]) => {
    if (args[0] === "worktree" && args[1] === "list") return { ok: true, stdout: listed[cwd] ?? "", stderr: "" };
    if (args[0] === "worktree") removeCalls.push([...args]);
    return { ok: true, stdout: "", stderr: "" };
  }),
}));

const roots: string[] = [];
function tempWorktree(name: string): string {
  const root = mkdtempSync(join(tmpdir(), "ascent-stranded-root-"));
  roots.push(root);
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  for (const k of Object.keys(listed)) delete listed[k];
  removeCalls.length = 0;
});

describe("parseWorktreeList", () => {
  it("reads blank-line-separated porcelain blocks, detached ones included", () => {
    const out = parseWorktreeList(
      "worktree C:/paired/api\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/tmp/ascent-loop-x\nHEAD def\nbranch refs/heads/ascent/loop-1-api\n\nworktree C:/tmp/other\nHEAD 999\ndetached\n",
    );
    expect(out).toEqual([
      { dir: "C:/paired/api", branch: "main" },
      { dir: "C:/tmp/ascent-loop-x", branch: "ascent/loop-1-api" },
      { dir: "C:/tmp/other", branch: null },
    ]);
  });
});

describe("isLoopTempWorktree", () => {
  it("accepts only a direct child of the temp root carrying this module's own prefix", () => {
    expect(isLoopTempWorktree("C:/tmp/ascent-loop-ab12", "C:/tmp")).toBe(true);
    expect(isLoopTempWorktree("C:\\tmp\\ascent-loop-ab12", "C:/tmp/")).toBe(true); // separators, trailing slash
    expect(isLoopTempWorktree("C:/tmp/nested/ascent-loop-ab12", "C:/tmp")).toBe(false);
    expect(isLoopTempWorktree("C:/tmp/my-project", "C:/tmp")).toBe(false);
    expect(isLoopTempWorktree("C:/work/ascent-loop-ab12", "C:/tmp")).toBe(false);
  });
});

describe("removeStrandedWorktrees", () => {
  const deps = (tempRoot: string) => ({ pairedPath: async () => "C:/paired/api", tempRoot: () => tempRoot });

  it("removes the temp checkout of a branch it was given, and deletes the directory", async () => {
    const dir = tempWorktree("ascent-loop-dead");
    const root = join(dir, "..");
    listed["C:/paired/api"] = `worktree C:/paired/api\nbranch refs/heads/main\n\nworktree ${dir}\nbranch refs/heads/ascent/loop-1-api\n`;

    const removed = await removeStrandedWorktrees(
      [{ orgSlug: "acme", repoFullName: "acme/api", branch: "ascent/loop-1-api" }],
      deps(root),
    );

    expect(removed).toEqual([dir]);
    expect(existsSync(dir)).toBe(false);
    expect(removeCalls.some((c) => c[1] === "remove" && c[3] === dir)).toBe(true);
    expect(removeCalls.some((c) => c[1] === "prune")).toBe(true);
  });

  it("never touches a worktree whose branch belongs to a run it was not given — a LIVE run's, for instance", async () => {
    const dead = tempWorktree("ascent-loop-dead");
    const live = join(dead, "..", "ascent-loop-live");
    mkdirSync(live, { recursive: true });
    listed["C:/paired/api"] = `worktree ${dead}\nbranch refs/heads/ascent/loop-1-api\n\nworktree ${live}\nbranch refs/heads/ascent/loop-2-api\n`;

    const removed = await removeStrandedWorktrees(
      [{ orgSlug: "acme", repoFullName: "acme/api", branch: "ascent/loop-1-api" }],
      deps(join(dead, "..")),
    );

    expect(removed).toEqual([dead]);
    expect(existsSync(live), "a live run's worktree was deleted").toBe(true);
  });

  it("never touches a directory outside the temp root, even on a matching branch", async () => {
    const root = mkdtempSync(join(tmpdir(), "ascent-stranded-root-"));
    roots.push(root);
    listed["C:/paired/api"] = `worktree C:/paired/api\nbranch refs/heads/ascent/loop-1-api\n`;

    const removed = await removeStrandedWorktrees(
      [{ orgSlug: "acme", repoFullName: "acme/api", branch: "ascent/loop-1-api" }],
      deps(root),
    );

    expect(removed).toEqual([]);
    expect(removeCalls).toEqual([]);
  });

  it("skips a repo whose pairing is gone rather than failing the sweep", async () => {
    const removed = await removeStrandedWorktrees([{ orgSlug: "acme", repoFullName: "acme/api", branch: "b" }], {
      pairedPath: async () => null,
      tempRoot: () => tmpdir(),
    });
    expect(removed).toEqual([]);
  });
});
