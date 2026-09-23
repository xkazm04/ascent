// ADOPTING HELD WORK, against REAL git repositories made in the OS temp dir (challenge-2026-09-23,
// card live-war-room#B).
//
// Real git for the reason `runner-branch.test.ts` gives: the load-bearing claims are about what git
// does — the commits that land are byte-for-byte the ones the reviewer was shown, and a conflict leaves
// the lane's worktree exactly where it was (HEAD unmoved, nothing half-applied). A mocked `runGit`
// would agree with whatever the code asked for.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptHeldCommits, isHeldBranchName, parseNumstat, readHeldDiff } from "./lane-adopt";

let repo: string;
let lane: string;
const RUNNER = "ascent/runner";
const HELD = "ascent/held/p1";
const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const git = (...args: string[]) => run(repo, ...args);
const commitOn = (branch: string, file: string, body: string) => {
  git("checkout", "-q", branch);
  writeFileSync(join(repo, file), body, "utf8");
  git("add", "-A");
  git("commit", "-q", "-m", `${branch}: ${file}`);
  git("checkout", "-q", "main");
};
/** The lane's throwaway worktree, cut from the runner branch exactly as the engine cuts it. */
const cutLane = () => {
  lane = join(mkdtempSync(join(tmpdir(), "ascent-adopt-wt-")), "wt");
  git("worktree", "add", "-q", "-b", "ascent/loop-x", lane, RUNNER);
  return run(lane, "rev-parse", "HEAD");
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ascent-adopt-test-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "adopt-test@ascent.invalid");
  git("config", "user.name", "Adopt Test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n", "utf8");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  git("branch", RUNNER);
  git("branch", HELD, RUNNER);
  commitOn(HELD, "a.ts", "export const a = 2;\nexport const aa = 2;\n");
  commitOn(HELD, "b.ts", "export const b = 1;\n");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  if (lane) rmSync(join(lane, ".."), { recursive: true, force: true });
});

describe("adoptHeldCommits", () => {
  it("lands exactly the held commits on the lane, byte-identical to what the reviewer was shown", async () => {
    const before = cutLane();
    const out = await adoptHeldCommits({ dir: lane, heldBranch: HELD });
    expect(out).toEqual({ ok: true, commits: 2 });
    expect(run(lane, "diff", "--name-only", `${before}..HEAD`).split("\n")).toEqual(["a.ts", "b.ts"]);
    expect(run(lane, "diff", `${before}..HEAD`)).toBe(git("diff", `${RUNNER}..${HELD}`));
  });

  it("aborts cleanly when the runner branch has since gained a conflicting edit", async () => {
    commitOn(RUNNER, "a.ts", "export const a = 3;\n");
    const before = cutLane();
    const out = await adoptHeldCommits({ dir: lane, heldBranch: HELD });
    expect(out.ok).toBe(false);
    expect(out.ok ? "" : out.reason).toMatch(/conflict/i);
    expect(out.ok ? "" : out.reason).toContain("a.ts");
    expect(run(lane, "rev-parse", "HEAD")).toBe(before);
    expect(run(lane, "status", "--porcelain")).toBe("");
  });

  it("refuses a held branch that no longer exists, and one the lane already carries", async () => {
    cutLane();
    const gone = await adoptHeldCommits({ dir: lane, heldBranch: "ascent/held/nope" });
    expect(gone).toMatchObject({ ok: false, reason: expect.stringMatching(/no longer exists/) });
    run(lane, "merge", "-q", "--ff-only", HELD);
    const empty = await adoptHeldCommits({ dir: lane, heldBranch: HELD });
    expect(empty).toMatchObject({ ok: false, reason: expect.stringMatching(/no commit/) });
  });

  it("guard: never hands git a ref that is not a held branch", async () => {
    cutLane();
    for (const bad of ["main", "--upload-pack=x", "ascent/held/../main", "ascent/held/"]) {
      expect(isHeldBranchName(bad)).toBe(false);
      expect(await adoptHeldCommits({ dir: lane, heldBranch: bad })).toMatchObject({ ok: false });
    }
    expect(isHeldBranchName(HELD)).toBe(true);
  });
});

describe("readHeldDiff — what the inbox shows", () => {
  it("counts the held commits and each file's added/deleted lines against the runner branch", async () => {
    commitOn(RUNNER, "c.ts", "export const c = 1;\n");
    const out = await readHeldDiff(repo, HELD);
    expect(out).toEqual({
      ok: true,
      diff: { heldBranch: HELD, commits: 2, files: [{ path: "a.ts", added: 2, deleted: 1 }, { path: "b.ts", added: 1, deleted: 0 }] },
    });
  });

  it("says why when the branch cannot be read", async () => {
    expect(await readHeldDiff(repo, "ascent/held/nope")).toMatchObject({ ok: false });
  });

  it("parses numstat, binary files included", () => {
    expect(parseNumstat("3\t1\tsrc/a.ts\0-\t-\tlogo.png\0")).toEqual([
      { path: "src/a.ts", added: 3, deleted: 1 },
      { path: "logo.png", added: null, deleted: null },
    ]);
  });
});
