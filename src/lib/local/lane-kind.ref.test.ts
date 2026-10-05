// THE LANE KIND READS THE BRANCH THE LANE IS CUT FROM, against real git.
//
// Measured 2026-10-05: the standing runner landed a foundation on `ascent/runner`; the proposal then
// read the operator's checkout, saw no `.ai/` spine, and armed the same foundation lane every round —
// it wrote nothing, and the repo backed off as dry.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasFoundation, proposeLaneKind } from "./lane-kind";

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const none = async () => [] as never[];
const noneDispatched = async () => new Set<string>();

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ascent-lane-kind-ref-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@ascent.invalid");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "# x\n");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  // The runner branch carries the foundation; the checkout (main) does not.
  git("checkout", "-q", "-b", "ascent/runner");
  mkdirSync(join(repo, ".ai"));
  writeFileSync(join(repo, ".ai", "manifest.yaml"), "version: 1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "chore(.ai): install the AI-native foundation");
  git("checkout", "-q", "main");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("proposeLaneKind with a ref", () => {
  it("does not re-arm a foundation the runner branch already carries", async () => {
    expect(await hasFoundation(repo)).toBe(false);
    expect(await hasFoundation(repo, "refs/heads/ascent/runner")).toBe(true);
    const plan = await proposeLaneKind(repo, none, noneDispatched, "refs/heads/ascent/runner");
    expect(plan.kind).not.toBe("foundation");
  });

  it("without a ref it still reads the checkout, as every non-runner run always did", async () => {
    const plan = await proposeLaneKind(repo, none, noneDispatched);
    expect(plan.kind).toBe("foundation");
  });

  it("an unresolvable ref reads as absent — the honest default for unreadable evidence", async () => {
    expect(await hasFoundation(repo, "refs/heads/no-such-branch")).toBe(false);
  });
});
