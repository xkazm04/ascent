// The run branch and the worktree it hangs off, driven against a real git repository.
//
// Real git, for the same reason `lane-install.test.ts` uses it: the claim under test is "a second run
// of the same repo still gets a branch", and only git can refuse a name. A mocked runGit would let
// the regression back in by agreeing with whatever the code asked for.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchNameFor, createLoopWorktree, removeLoopWorktree, runStamp } from "./loop-worktree";

let repo: string;
const created: Awaited<ReturnType<typeof createLoopWorktree>>[] = [];

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ascent-wt-test-"));
  writeFileSync(join(repo, "README.md"), "# fixture\n", "utf8");
  git("init", "-b", "main");
  git("config", "user.email", "wt-test@ascent.invalid");
  git("config", "user.name", "Worktree Test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-m", "chore: fixture");
});

afterEach(async () => {
  for (const wt of created.splice(0)) await removeLoopWorktree(wt).catch(() => null);
  rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("runStamp", () => {
  it("resolves to SECONDS, so two runs in one minute do not ask for one branch name", () => {
    // `YYYYMMDDHHmmss` — 14 digits. At minute resolution (the shape until 2026-08-29) a drive's
    // back-to-back runs collided; the L2 certification measured a 2-run drive finishing in 12s.
    const stamp = runStamp(new Date("2026-08-29T11:13:35.500Z"));
    expect(stamp).toBe("20260829111335");
    expect(runStamp(new Date("2026-08-29T11:13:29.000Z"))).not.toBe(stamp);
  });
});

describe("createLoopWorktree", () => {
  it("gives the run its branch and a checkout off HEAD", async () => {
    const wt = await createLoopWorktree(repo, "acme/api", "20260829111335");
    created.push(wt);
    expect(wt.branch).toBe(branchNameFor("acme/api", "20260829111335"));
    expect(git("branch", "--list", wt.branch, "--format=%(refname:short)")).toBe(wt.branch);
  });

  it("takes the NEXT name when the branch already exists, instead of failing the lane", async () => {
    // The collision the drive produces: two runs of one repo inside a single stamp tick. Before this,
    // the second lane died on `fatal: a branch named '…' already exists`, produced no commits, and the
    // drive read the resulting zero debt movement as `dry` — reporting an infrastructure failure as a
    // finding about the operator's repository.
    const first = await createLoopWorktree(repo, "acme/api", "20260829111335");
    created.push(first);
    const second = await createLoopWorktree(repo, "acme/api", "20260829111335");
    created.push(second);

    expect(second.branch).toBe(`${first.branch}-2`);
    expect(second.dir).not.toBe(first.dir);
    expect(git("branch", "--list", "ascent/loop-*", "--format=%(refname:short)").split("\n").sort()).toEqual([
      first.branch,
      second.branch,
    ]);
  });

  it("still throws on a failure that is not a name collision", async () => {
    // A path that is not a git repository. Retrying this would produce the same error more slowly.
    const notARepo = mkdtempSync(join(tmpdir(), "ascent-wt-norepo-"));
    try {
      await expect(createLoopWorktree(notARepo, "acme/api", "20260829111335")).rejects.toThrow(
        /Could not create the worktree for acme\/api/,
      );
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});
