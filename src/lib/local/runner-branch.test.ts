// THE RUNNER BRANCH, against REAL git repositories made in the OS temp dir.
//
// Real git for the reason `loop-land.test.ts` gives: every claim here is about what git refuses — a
// conflict, a non-fast-forward — and a mocked `runGit` would agree with whatever the code asked for.
// The load-bearing claims are the negative ones: a conflicting merge-in moves NOTHING and leaves no
// temp worktree behind, a refused land does not move the runner branch, and nothing here ever touches
// the operator's checked-out branch or working tree.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRunnerBranch, landOnRunner, mergeInBase, resolveBaseBranch, runnerAheadCount, runnerTip } from "./runner-branch";

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const rev = (ref: string) => git("rev-parse", ref);
const write = (name: string, body: string) => writeFileSync(join(repo, name), body, "utf8");
const commitOn = (branch: string, file: string, body: string) => {
  const on = git("rev-parse", "--abbrev-ref", "HEAD");
  git("checkout", "-q", branch);
  write(file, body);
  git("add", "-A");
  git("commit", "-q", "-m", `${branch}: ${file}`);
  git("checkout", "-q", on);
};
const worktrees = () => git("worktree", "list", "--porcelain").split(/\r?\n/).filter((l) => l.startsWith("worktree ")).length;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ascent-runner-test-"));
  write("README.md", "# fixture\n");
  write("shared.ts", "export const v = 1;\n");
  git("init", "-q", "-b", "main");
  git("config", "user.email", "runner-test@ascent.invalid");
  git("config", "user.name", "Runner Test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("resolveBaseBranch", () => {
  it("prefers the remote's default branch when it exists locally", async () => {
    git("branch", "trunk");
    git("update-ref", "refs/remotes/origin/trunk", "HEAD");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    expect(await resolveBaseBranch(repo)).toBe("trunk");
  });

  it("falls back to the checkout's current branch", async () => {
    expect(await resolveBaseBranch(repo)).toBe("main");
  });

  it("is null on a detached checkout with no remote", async () => {
    git("checkout", "-q", "--detach");
    expect(await resolveBaseBranch(repo)).toBeNull();
  });
});

describe("ensureRunnerBranch", () => {
  it("creates the runner branch at the base tip without checking it out", async () => {
    const out = await ensureRunnerBranch(repo, "main");
    expect(out.ok).toBe(true);
    expect(rev("ascent/runner")).toBe(rev("main"));
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("is idempotent, and refuses a base that does not exist", async () => {
    await ensureRunnerBranch(repo, "main");
    commitOn("ascent/runner", "lane.ts", "lane\n");
    const tip = rev("ascent/runner");
    expect((await ensureRunnerBranch(repo, "main")).sha).toBe(tip);
    expect(rev("ascent/runner")).toBe(tip);
    git("update-ref", "-d", "refs/heads/ascent/runner");
    expect((await ensureRunnerBranch(repo, "nope")).ok).toBe(false);
  });
});

describe("mergeInBase — merge, never rebase, in a temp worktree", () => {
  beforeEach(async () => {
    await ensureRunnerBranch(repo, "main");
  });

  it("is a no-op when the runner already contains the base", async () => {
    commitOn("ascent/runner", "lane.ts", "lane\n");
    const before = rev("ascent/runner");
    expect(await mergeInBase(repo, "main")).toMatchObject({ ok: true, changed: false, sha: before });
    expect(rev("ascent/runner")).toBe(before);
  });

  it("fast-forwards a runner with nothing of its own", async () => {
    commitOn("main", "op.ts", "operator work\n");
    expect(await mergeInBase(repo, "main")).toMatchObject({ ok: true, changed: true, sha: rev("main") });
    expect(rev("ascent/runner")).toBe(rev("main"));
  });

  it("merges a moved base in cleanly — lane SHAs kept, operator checkout untouched, no worktree left", async () => {
    commitOn("ascent/runner", "lane.ts", "lane\n");
    const lane = rev("ascent/runner");
    commitOn("main", "op.ts", "operator work\n");
    write("dirty.txt", "the operator is mid-edit\n");
    const head = rev("HEAD");

    const out = await mergeInBase(repo, "main");

    expect(out).toMatchObject({ ok: true, changed: true });
    const tip = rev("ascent/runner");
    expect(git("rev-list", "--parents", "-n", "1", tip).split(" ")).toHaveLength(3); // a merge commit
    expect(git("merge-base", "--is-ancestor", lane, tip)).toBe(""); // the lane's commit is kept, not rewritten
    expect(git("merge-base", "--is-ancestor", "main", tip)).toBe("");
    expect(rev("HEAD")).toBe(head);
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(readFileSync(join(repo, "dirty.txt"), "utf8")).toContain("mid-edit");
    expect(worktrees()).toBe(1);
  });

  it("aborts a conflict, names the files, and moves nothing", async () => {
    commitOn("ascent/runner", "shared.ts", "export const v = 2; // lane\n");
    commitOn("main", "shared.ts", "export const v = 3; // operator\n");
    const before = rev("ascent/runner");

    const out = await mergeInBase(repo, "main");

    expect(out).toMatchObject({ ok: false, conflict: true, files: ["shared.ts"] });
    expect(out.note).toContain("shared.ts");
    expect(rev("ascent/runner")).toBe(before);
    expect(worktrees()).toBe(1);
    expect(git("status", "--porcelain")).toBe("");
  });
});

describe("landOnRunner — fast-forward only, never forced", () => {
  beforeEach(async () => {
    await ensureRunnerBranch(repo, "main");
  });

  const laneFrom = (name: string, from: string, file: string) => {
    git("branch", name, from);
    commitOn(name, file, `${name}\n`);
  };

  it("fast-forwards the runner branch to a lane cut from it", async () => {
    laneFrom("ascent/loop-1-o-a", "ascent/runner", "fix.ts");
    const out = await landOnRunner(repo, "ascent/loop-1-o-a");
    expect(out.ok).toBe(true);
    expect(rev("ascent/runner")).toBe(rev("ascent/loop-1-o-a"));
    expect(await runnerTip(repo)).toBe(rev("ascent/loop-1-o-a"));
    expect(await runnerAheadCount(repo, "main")).toBe(1);
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("refuses a lane that is no longer a fast-forward — the runner branch does not move", async () => {
    laneFrom("arm-a", "ascent/runner", "a.ts");
    laneFrom("arm-b", "ascent/runner", "b.ts");
    await landOnRunner(repo, "arm-a");
    const after = rev("ascent/runner");

    const out = await landOnRunner(repo, "arm-b");

    expect(out.ok).toBe(false);
    expect(out.note).toMatch(/no longer a fast-forward/);
    expect(rev("ascent/runner")).toBe(after);
  });

  it("says a lane already on the runner branch has nothing to land", async () => {
    laneFrom("lane", "ascent/runner", "a.ts");
    await landOnRunner(repo, "lane");
    expect(await landOnRunner(repo, "lane")).toMatchObject({ ok: false });
  });
});
