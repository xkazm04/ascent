// THE REPOSITORY'S OWN COMMIT HOOK, AND THE LADDER THAT STOPS IT EATING THE WORK.
//
// Driven against a REAL git repository with a REAL `commit-msg` hook installed, because the whole
// failure this covers was git-side: `git commit` exited non-zero, `commitAgentWork` returned
// `committed: false`, and the lane deleted a throwaway worktree holding 10–17 changes an agent had
// spent up to twenty minutes writing. Seven of eight kp lanes in campaign 5, $5–11 each
// (docs/harness/reflection-2026-09-01.md, finding 5). A mocked `runGit` would assert the ladder's
// shape and prove nothing about whether git accepts what it writes.

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAgentWork } from "./lane-commit";

const dirs: string[] = [];

/** A repo whose `commit-msg` hook rejects every message that does not satisfy `accept`. */
function repoWithHook(accept: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ascent-lane-hook-"));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "loop@ascent.test");
  git("config", "user.name", "Ascent Loop");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "seed\n", "utf8");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  const hook = join(dir, ".git", "hooks", "commit-msg");
  writeFileSync(hook, `#!/bin/sh\n${accept}\n`, "utf8");
  chmodSync(hook, 0o755);
  return dir;
}

const log = (dir: string) => execFileSync("git", ["log", "-1", "--format=%B"], { cwd: dir, encoding: "utf8" });
const subject = (dir: string) => execFileSync("git", ["log", "-1", "--format=%s"], { cwd: dir, encoding: "utf8" }).trim();
const count = (dir: string) => execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const work = (dir: string) => writeFileSync(join(dir, "src.txt"), "the agent's ten changes\n", "utf8");

describe("the commit ladder — a hook must never cost the lane its work", () => {
  it("commits plainly when the repository's hook accepts the subject", async () => {
    // kp's own rule, in one line: the subject must not be a session report.
    // Judged on the SUBJECT only, like every real one — the narrative is welcome in the body.
    const dir = repoWithHook(`head -1 "$1" | grep -qi "here's what" && exit 1\nexit 0`);
    work(dir);
    const res = await commitAgentWork({
      dir,
      branch: "ascent/loop-x",
      cycle: 1,
      batch: [{ id: "rec-1" }],
      summary: "All work is in the tree. Here's what I found and did.\n\nRESOLVED: rec-1 - Added a permissions scope to the workflow",
    });
    expect(res.committed).toBe(true);
    expect(res.exempted).toBeUndefined();
    expect(res.hookBypassed).toBeUndefined();
    // The subject came from the RESOLVED headline, so the hook never saw the prose.
    expect(subject(dir)).toBe("fix: Added a permissions scope to the workflow");
    expect(count(dir)).toBe("2");
  });

  it("retries ONCE with the waiver the hook itself publishes, and says so", async () => {
    // The shape of kp's `.githooks/commit-msg`: refuse, unless the body carries the exemption trailer.
    const dir = repoWithHook(`grep -q "Commit-convention-exemption:" "$1" && exit 0\necho "commit-msg: message rejected" >&2\nexit 1`);
    work(dir);
    const res = await commitAgentWork({
      dir,
      branch: "ascent/loop-x",
      cycle: 2,
      batch: [{ id: "rec-1" }],
      summary: "RESOLVED: rec-1 - Removed the duplicated retry helper",
    });
    expect(res.committed).toBe(true);
    expect(res.exempted).toBe(true);
    expect(res.hookBypassed).toBeUndefined();
    expect(res.summary).toContain("Commit-convention-exemption");
    expect(res.summary).toContain("message rejected");
    const body = log(dir);
    expect(body).toContain("Commit-convention-exemption:");
    // The waiver rides WITH the trailers, and the adjudication's trailer still parses.
    expect(body).toContain("Ascent-Resolves: rec-1");
    expect(count(dir)).toBe("2");
  });

  it("bypasses a hook that refuses everything, LOUDLY, rather than discard the work", async () => {
    const dir = repoWithHook(`echo "commit-msg: this repository refuses everything" >&2\nexit 1`);
    work(dir);
    const res = await commitAgentWork({
      dir,
      branch: "ascent/loop-x",
      cycle: 3,
      batch: [{ id: "rec-1" }],
      summary: "RESOLVED: rec-1 - Split the overgrown scanner module",
    });
    expect(res.committed).toBe(true);
    expect(res.exempted).toBe(true);
    expect(res.hookBypassed).toBe(true);
    // The lane log has to make the bypass unmissable and say what it means.
    expect(res.summary).toContain("COMMIT HOOK WAS BYPASSED");
    expect(res.summary).toContain("--no-verify");
    expect(res.summary).toContain("this repository refuses everything");
    expect(res.summary).toMatch(/review this commit/i);
    // And the WORK — the only thing that actually mattered — is on the branch.
    expect(count(dir)).toBe("2");
    expect(log(dir)).toContain("Ascent-Resolves: rec-1");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).trim()).toBe("");
  });
});
