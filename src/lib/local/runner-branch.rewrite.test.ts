// THE RUNNER BRANCH OVER A REWRITTEN BASE, against real git (see runner-branch.test.ts for why real).
//
// Measured 2026-10-05: an owner filtered their history (stopped tracking a directory), every commit got
// a new SHA, and the runner branch — cut from the old base, carrying zero loop work — paused its repo on
// a 27-file merge conflict. A runner with nothing of its own is re-cut; one with real work still merges.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRunnerBranch, mergeInBase } from "./runner-branch";

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const write = (name: string, body: string) => writeFileSync(join(repo, name), body, "utf8");
const commit = (msg: string) => {
  git("add", "-A");
  git("commit", "-q", "-m", msg);
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ascent-runner-rewrite-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "runner-test@ascent.invalid");
  git("config", "user.name", "Runner Test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  write("README.md", "# fixture\n");
  commit("initial");
  write("a.txt", "one\n");
  commit("add a");
  write("runs.log", "noise\n");
  commit("add runs");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

/** Rewrite `main` after `initial`: the same two patches re-committed (new SHAs), then the noise dropped. */
function rewriteMain(): void {
  git("reset", "-q", "--hard", "HEAD~2");
  write("a.txt", "one\n");
  git("add", "-A");
  git("commit", "-q", "-m", "add a (rewritten)", "--date", "2001-01-01T00:00:00");
  write("runs.log", "noise\n");
  commit("add runs (rewritten)");
  git("rm", "-q", "runs.log");
  commit("stop tracking runs");
}

describe("mergeInBase over a rewritten base", () => {
  it("re-cuts a runner that carries nothing the base lacks, instead of pausing on a conflict", async () => {
    await ensureRunnerBranch(repo, "main");
    rewriteMain();
    const res = await mergeInBase(repo, "main");
    expect(res.ok).toBe(true);
    expect(git("rev-parse", "ascent/runner")).toBe(git("rev-parse", "main"));
    if (res.ok) expect(res.note).toMatch(/re-cut/);
  });

  it("re-cuts when the filter also rewrote PATCHES, because the runner tip is an old state of the base", async () => {
    // The measured case: the dropped directory changed the patches too, so `git cherry` sees commits with
    // no equivalent. The base's own reflog still proves the runner is just an old snapshot of it.
    await ensureRunnerBranch(repo, "main");
    git("reset", "-q", "--hard", "HEAD~2");
    write("a.txt", "one\n");
    git("add", "-A");
    git("commit", "-q", "-m", "add a (filtered)", "--date", "2001-01-01T00:00:00");
    expect(git("cherry", "main", "ascent/runner")).toMatch(/^\+ /m);
    const res = await mergeInBase(repo, "main");
    expect(res.ok).toBe(true);
    expect(git("rev-parse", "ascent/runner")).toBe(git("rev-parse", "main"));
  });

  it("still MERGES when the runner holds a commit of its own — real loop work is never discarded", async () => {
    await ensureRunnerBranch(repo, "main");
    git("checkout", "-q", "ascent/runner");
    write("loop.txt", "verified lane work\n");
    commit("lane: loop work");
    git("checkout", "-q", "main");
    rewriteMain();
    const runnerBefore = git("rev-parse", "ascent/runner");
    const res = await mergeInBase(repo, "main");
    if (res.ok) {
      // Merged: the loop's commit is still reachable from the runner.
      expect(git("merge-base", "--is-ancestor", runnerBefore, "ascent/runner")).toBe("");
      expect(res.note).not.toMatch(/re-cut/);
    } else {
      // Or it conflicted and paused — but it never re-cut away the loop's work.
      expect(git("rev-parse", "ascent/runner")).toBe(runnerBefore);
    }
  });
});
