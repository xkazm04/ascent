// MERGING THE RUNNER BRANCH OUT — the operator's one door from `ascent/runner` into their base branch,
// against REAL git repositories in the OS temp dir. Three outcomes, and the negative half of each is
// what matters: a dirty or diverged checkout is NEVER written to — the commands come back instead.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRunnerBranch, landOnRunner, mergeRunnerInto } from "./runner-branch";

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const rev = (ref: string) => git("rev-parse", ref);
const write = (name: string, body: string) => writeFileSync(join(repo, name), body, "utf8");
const read = (name: string) => readFileSync(join(repo, name), "utf8");

/** A verified lane landed on the runner branch: cut from it, one commit, fast-forwarded. */
async function landLane(file: string): Promise<void> {
  const on = git("rev-parse", "--abbrev-ref", "HEAD");
  git("checkout", "-q", "-b", `lane-${file}`, "ascent/runner");
  write(file, "lane work\n");
  git("add", "-A");
  git("commit", "-q", "-m", `lane: ${file}`);
  git("checkout", "-q", on);
  expect((await landOnRunner(repo, `lane-${file}`)).ok).toBe(true);
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "ascent-runner-out-"));
  write("README.md", "# fixture\n");
  git("init", "-q", "-b", "main");
  git("config", "user.email", "runner-test@ascent.invalid");
  git("config", "user.name", "Runner Test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  await ensureRunnerBranch(repo, "main");
  await landLane("fix.ts");
}, 30_000);

afterEach(() => rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

describe("mergeRunnerInto", () => {
  it("base NOT checked out → moves the base ref with update-ref; no working copy touched", async () => {
    git("checkout", "-q", "-b", "elsewhere");
    const out = await mergeRunnerInto(repo, "main");
    expect(out).toMatchObject({ ok: true, outcome: "fast-forward", mergedSha: rev("ascent/runner") });
    expect(rev("main")).toBe(rev("ascent/runner"));
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("elsewhere");
    expect(git("status", "--porcelain")).toBe("");
  });

  it("base checked out AND clean → merge --ff-only in that checkout", async () => {
    const out = await mergeRunnerInto(repo, "main");
    expect(out).toMatchObject({ ok: true, outcome: "merged" });
    expect(rev("HEAD")).toBe(rev("ascent/runner"));
    expect(read("fix.ts")).toBe("lane work\n");
    expect(git("rev-list", "--merges", "--count", "HEAD")).toBe("0");
  });

  it("base checked out but DIRTY → the commands, and nothing touched", async () => {
    write("README.md", "# the operator is editing\n");
    const before = rev("main");
    const out = await mergeRunnerInto(repo, "main");
    expect(out.ok).toBe(false);
    expect(out.outcome).toBe("commands");
    if (out.outcome === "commands") expect(out.commands).toContain("git merge --ff-only ascent/runner");
    expect(rev("main")).toBe(before);
    expect(read("README.md")).toContain("editing");
  });

  it("DIVERGED → a real merge is the operator's: the commands, nothing moved", async () => {
    write("mine.ts", "operator commit\n");
    git("add", "-A");
    git("commit", "-q", "-m", "operator");
    const before = rev("main");
    const out = await mergeRunnerInto(repo, "main");
    expect(out.ok).toBe(false);
    if (out.outcome === "commands") expect(out.commands).toContain("git merge ascent/runner");
    expect(rev("main")).toBe(before);
  });

  it("DIVERGED and not checked out → includes the switch, still moves nothing", async () => {
    write("mine.ts", "operator commit\n");
    git("add", "-A");
    git("commit", "-q", "-m", "operator");
    git("checkout", "-q", "-b", "elsewhere");
    const before = rev("main");
    const out = await mergeRunnerInto(repo, "main");
    if (out.outcome !== "commands") throw new Error("expected commands");
    expect(out.commands).toEqual([expect.stringContaining("cd "), "git switch main", "git merge ascent/runner"]);
    expect(rev("main")).toBe(before);
  });

  it("nothing to merge once the base contains the runner branch", async () => {
    await mergeRunnerInto(repo, "main");
    expect(await mergeRunnerInto(repo, "main")).toMatchObject({ ok: true, outcome: "fast-forward" });
  });
});
