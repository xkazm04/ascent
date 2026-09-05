// LANDING, against a REAL git repository.
//
// Real git for the same reason `loop-worktree.test.ts` uses it: every claim here is about what git
// refuses — a non-fast-forward, a merge that would overwrite an edited file — and a mocked `runGit`
// would agree with whatever the code asked for, which is precisely the regression that matters.
//
// The load-bearing claim is the REFUSAL one: when landing cannot happen, the operator's tree must be
// exactly as they left it. Each refusal case therefore asserts the checkout's sha AND the on-disk
// bytes of the file at stake, not just the returned outcome.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedPaths, dirtyPaths, landLaneBranch } from "./loop-land";

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const head = () => git("rev-parse", "HEAD");
const write = (name: string, body: string) => writeFileSync(join(repo, name), body, "utf8");
const read = (name: string) => readFileSync(join(repo, name), "utf8");

/** A lane branch as `createLoopWorktree` makes one: cut from HEAD, with one commit on it. */
function laneBranch(name: string, file: string, body: string): void {
  const on = git("rev-parse", "--abbrev-ref", "HEAD");
  git("checkout", "-b", name);
  write(file, body);
  git("add", "-A");
  git("commit", "-m", `lane: ${file}`);
  git("checkout", on);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ascent-land-test-"));
  write("README.md", "# fixture\n");
  git("init", "-b", "main");
  git("config", "user.email", "land-test@ascent.invalid");
  git("config", "user.name", "Land Test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-m", "initial");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("landLaneBranch", () => {
  it("fast-forwards a clean lane branch into the branch the checkout is on", async () => {
    const before = head();
    laneBranch("ascent/loop-1-acme-web", "fix.ts", "export const fixed = true;\n");

    const out = await landLaneBranch(repo, "ascent/loop-1-acme-web");

    expect(out.landed).toBe(true);
    expect(out.refusal).toBeNull();
    expect(out.into).toBe("main");
    expect(head()).toBe(git("rev-parse", "ascent/loop-1-acme-web"));
    expect(head()).not.toBe(before);
    expect(read("fix.ts")).toContain("fixed");
    // It is a FAST-FORWARD, not a merge commit: exactly one new commit, no second parent.
    expect(git("rev-list", "--count", `${before}..HEAD`)).toBe("1");
    expect(git("rev-list", "--merges", "--count", `${before}..HEAD`)).toBe("0");
  });

  it("is idempotent — a branch already contained is a no-op, not a failure", async () => {
    laneBranch("ascent/loop-1-acme-web", "fix.ts", "one\n");
    await landLaneBranch(repo, "ascent/loop-1-acme-web");
    const after = head();

    const again = await landLaneBranch(repo, "ascent/loop-1-acme-web");

    expect(again.landed).toBe(false);
    expect(again.refusal).toBe("already");
    expect(head()).toBe(after);
  });

  it("REFUSES a diverged branch and leaves the checkout untouched", async () => {
    laneBranch("ascent/loop-1-acme-web", "fix.ts", "lane work\n");
    // The operator commits on main after the lane branch was cut — no longer a fast-forward.
    write("mine.ts", "my own work\n");
    git("add", "-A");
    git("commit", "-m", "the operator's own commit");
    const before = head();

    const out = await landLaneBranch(repo, "ascent/loop-1-acme-web");

    expect(out.landed).toBe(false);
    expect(out.refusal).toBe("diverged");
    expect(out.reason).toContain("no longer a fast-forward");
    expect(head()).toBe(before);
    // And the lane's work is still exactly where `branch` mode would have left it.
    expect(git("rev-list", "--count", "HEAD..ascent/loop-1-acme-web")).not.toBe("0");
  });

  it("REFUSES rather than overwrite a file the operator has uncommitted changes in", async () => {
    laneBranch("ascent/loop-1-acme-web", "README.md", "# rewritten by the lane\n");
    write("README.md", "# I am editing this right now\n");
    const before = head();

    const out = await landLaneBranch(repo, "ascent/loop-1-acme-web");

    expect(out.landed).toBe(false);
    expect(out.refusal).toBe("uncommitted");
    expect(out.reason).toContain("README.md");
    // THE POINT OF THE WHOLE RULE: the operator's bytes, untouched.
    expect(read("README.md")).toBe("# I am editing this right now\n");
    expect(head()).toBe(before);
    expect(git("status", "--porcelain")).toContain("README.md");
  });

  it("lands past a dirty file the lane does NOT touch — a stop sign only where they collide", async () => {
    laneBranch("ascent/loop-1-acme-web", "fix.ts", "lane work\n");
    write("scratch.txt", "unrelated scratch\n");

    const out = await landLaneBranch(repo, "ascent/loop-1-acme-web");

    expect(out.landed).toBe(true);
    expect(read("scratch.txt")).toBe("unrelated scratch\n");
  });

  it("REFUSES on a detached HEAD — there is no branch to land into", async () => {
    laneBranch("ascent/loop-1-acme-web", "fix.ts", "lane work\n");
    const before = head();
    git("checkout", "--detach");

    const out = await landLaneBranch(repo, "ascent/loop-1-acme-web");

    expect(out.landed).toBe(false);
    expect(out.refusal).toBe("detached");
    expect(head()).toBe(before);
  });

  it("never touches a remote — no fetch, no push, no upstream", async () => {
    laneBranch("ascent/loop-1-acme-web", "fix.ts", "lane work\n");
    const calls: string[][] = [];
    await landLaneBranch(repo, "ascent/loop-1-acme-web", {
      git: async (cwd, args) => {
        calls.push([...args]);
        const { runGit } = await import("./git");
        return runGit(cwd, args);
      },
    });
    const verbs = calls.map((c) => c[0]);
    expect(verbs).not.toContain("push");
    expect(verbs).not.toContain("fetch");
    expect(verbs).not.toContain("reset");
    expect(verbs).not.toContain("stash");
    expect(verbs).not.toContain("checkout");
    expect(verbs).not.toContain("switch");
    // And the merge it DOES run is ff-only, always.
    expect(calls.find((c) => c[0] === "merge")).toEqual(["merge", "--ff-only", "ascent/loop-1-acme-web"]);
  });
});

describe("dirtyPaths / changedPaths", () => {
  it("reads modified, staged, untracked and both halves of a rename", () => {
    const porcelain = [" M src/a.ts", "A  src/b.ts", "?? scratch.txt", 'R  src/old.ts -> src/new.ts', ""].join("\n");
    expect(dirtyPaths(porcelain).sort()).toEqual(["scratch.txt", "src/a.ts", "src/b.ts", "src/new.ts", "src/old.ts"]);
  });

  it("unquotes a path git quoted for special characters", () => {
    expect(dirtyPaths(' M "src/a b.ts"')).toEqual(["src/a b.ts"]);
  });

  it("drops blank lines from a name-only diff", () => {
    expect(changedPaths("src/a.ts\n\nsrc/b.ts\n")).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
