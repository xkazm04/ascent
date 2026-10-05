// THE GATE-DECLARATION CASES, read off a REAL repository (2026-10-05): a temp git repo with a base
// commit and one lane commit, so the status read, the before/after ladder and the one run of a newly
// declared gate all go through git, the real resolver and the real command runner.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGit } from "@/lib/local/git";
import { checkGateDiff, type LaneVerdictEvidence } from "@/lib/local/lane-gate-diff";
import { bootstrapVerifyNote, gateChangeSentence } from "@/lib/local/lane-gate-diff-declare";
import { readGateDiffEvidence } from "@/lib/local/lane-gate-diff-load";
import { runVerifyCommand } from "@/lib/local/lane-guard";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sh = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

function write(dir: string, files: Record<string, string | null>) {
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    if (text === null) rmSync(abs, { force: true });
    else {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, text);
    }
  }
}

/** A repo at `base`, then one lane commit applying `lane`, judged with the lane's verdict. */
async function laneOver(base: Record<string, string>, lane: Record<string, string | null>, laneVerdict: LaneVerdictEvidence | null = null) {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-declare-"));
  dirs.push(dir);
  sh(dir, "init", "-q");
  sh(dir, "config", "user.email", "t@example.com");
  sh(dir, "config", "user.name", "t");
  sh(dir, "config", "core.autocrlf", "false");
  write(dir, base);
  sh(dir, "add", "-A");
  sh(dir, "commit", "-qm", "base");
  const before = sh(dir, "rev-parse", "HEAD");
  write(dir, lane);
  sh(dir, "add", "-A");
  sh(dir, "commit", "-qm", "lane");
  const changedPaths = sh(dir, "diff", "--name-only", "--no-renames", `${before}..HEAD`).split("\n").filter(Boolean);
  const git = (args: readonly string[]) => runGit(dir, args);
  const run = vi.fn(runVerifyCommand);
  const evidence = await readGateDiffEvidence({ git, dir, before, changedPaths, laneVerdict, verifyMs: 120_000, run });
  return { evidence, run, verdict: checkGateDiff(changedPaths, evidence) };
}

const manifest = (command: string) =>
  ["schema: ai-manifest", "schemaVersion: 0.1.0", "capabilities:", `  test: { command: "${command}", verified: true }`, "controls:", "  ciHardPass: [test]", ""].join("\n");
const pkg = (testAll: string) => JSON.stringify({ name: "g", scripts: { test: "node -e \"\"", "test:all": testAll } });
const verified = (command: string) => ({ verdict: "verified", command });
const skipped = { verdict: "skipped", command: null };

describe("A — an ADDED gate script over a real lane commit", () => {
  it("garden-vr: an added tools/guard/check.mjs the `dotnet test` ladder never runs is NOT void", async () => {
    const { verdict, evidence } = await laneOver(
      { "AGENTS.md": "# VR\nRun `dotnet test shared/core-dotnet` before pushing.\n", "src/Game.cs": "class G {}\n" },
      { "tools/guard/check.mjs": "console.log('guard');\n" },
    );
    expect(evidence.verifyLadder?.after.map((r) => r.command)).toEqual(["dotnet test shared/core-dotnet"]);
    expect(verdict.void).toBe(false);
  });

  it("an added scripts/verify.mjs that the declared `node scripts/verify.mjs` runs is void", async () => {
    const { verdict } = await laneOver({ ".ai/manifest.yaml": manifest("node scripts/verify.mjs") }, { "scripts/verify.mjs": "process.exit(0);\n" });
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toContain("runs it");
  });

  it("a modified tools/check.mjs that the `dotnet test` ladder never runs is NOT void (the ladder is read for it)", async () => {
    // Measured 2026-10-05: the ladder was read only for an ADDED script, so this was "could not be read".
    const { verdict, evidence } = await laneOver(
      { "AGENTS.md": "Run `dotnet test x/y` before pushing.\n", "tools/check.mjs": "a();\n" },
      { "tools/check.mjs": "b();\n" },
    );
    expect(evidence.verifyLadder).toBeDefined();
    expect(verdict.void).toBe(false);
  });

  it("a modified tools/check.mjs that the declared ladder RUNS is void", async () => {
    const { verdict } = await laneOver(
      { ".ai/manifest.yaml": manifest("node tools/check.mjs"), "tools/check.mjs": "a();\n" },
      { "tools/check.mjs": "b();\n" },
    );
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toContain("verify-command, modified");
  });
});

describe("B — a CHANGED declared gate over a real lane commit", () => {
  const BASE = { "AGENTS.md": "# Game\nRun `npm test` before pushing.\n" };
  const LANE = { "AGENTS.md": "# Game\nRun `npm run test:all` before pushing.\n" };

  it("measured with `npm test`, and `npm run test:all` passes on the tree -> NOT void, with the gate change", async () => {
    const { verdict, run } = await laneOver({ ...BASE, "package.json": pkg('node -e ""') }, LANE, verified("npm test"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(verdict.void).toBe(false);
    expect(verdict.gateChange).toMatchObject({ from: "npm test", to: "npm run test:all", files: ["AGENTS.md"], measured: "verified" });
    expect(gateChangeSentence(verdict.gateChange!)).toBe(
      "Gate changed: `npm test` -> `npm run test:all` (declared in AGENTS.md); this lane was verified against `npm test`, " +
        "`npm run test:all` passes on its tree, and every later run is verified against `npm run test:all` — review it when merging the runner branch.",
    );
  }, 60_000);

  it("the same change where the new command FAILS is void", async () => {
    const { verdict } = await laneOver({ ...BASE, "package.json": pkg('node -e "process.exit(1)"') }, LANE, verified("npm test"));
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toContain("does not pass here");
  }, 60_000);

  it("a new command of `echo ok` is void, and nothing is run", async () => {
    const { verdict, run } = await laneOver({ ".ai/manifest.yaml": manifest("npm test") }, { ".ai/manifest.yaml": manifest("echo ok") }, verified("npm test"));
    expect(run).not.toHaveBeenCalled();
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toContain("checks nothing");
  });

  it("a verdict reached with another command is void, and nothing is run", async () => {
    const { verdict, run } = await laneOver({ ...BASE, "package.json": pkg('node -e ""') }, LANE, verified("npm run lint"));
    expect(run).not.toHaveBeenCalled();
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toContain("not reached with `npm test`");
  });

  it("removing the declared gate is void", async () => {
    const { verdict } = await laneOver({ ...BASE, "src/a.ts": "export {};\n" }, { "AGENTS.md": null }, verified("npm test"));
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toContain("leaves no verify command resolved");
  });
});

describe("D — a BOOTSTRAP over a real lane commit", () => {
  const BASE = { "Source/Game.cpp": "int main() {}\n" };

  it("a first gate that passes on the tree is NOT void, and carries a bootstrap change", async () => {
    const { verdict } = await laneOver(BASE, { ".ai/manifest.yaml": manifest("node apps/lint.mjs"), "apps/lint.mjs": "console.log('ok');\n" }, skipped);
    expect(verdict.void).toBe(false);
    expect(verdict.gateChange).toMatchObject({ from: null, to: "node apps/lint.mjs", passed: "node apps/lint.mjs", rung: "primary", measured: "bootstrap" });
  }, 60_000);

  it("a first gate that FAILS on the tree is void", async () => {
    const { verdict } = await laneOver(BASE, { ".ai/manifest.yaml": manifest("node apps/lint.mjs"), "apps/lint.mjs": "process.exit(1);\n" }, skipped);
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toContain("(none resolved) -> `node apps/lint.mjs`");
    expect(verdict.reason).toContain("does not pass here");
  }, 60_000);

  it("a bootstrap that ADDS tools/lint.mjs and declares `node tools/lint.mjs` is NOT void — the script is the new gate", async () => {
    const { verdict, run } = await laneOver(BASE, { ".ai/manifest.yaml": manifest("node tools/lint.mjs"), "tools/lint.mjs": "console.log('ok');\n" }, skipped);
    expect(run).toHaveBeenCalledTimes(1);
    expect(verdict.void).toBe(false);
    // The call site upgrades `skipped` to `verified` on exactly this shape (loop-lane.gate-declare.test.ts).
    expect(verdict.gateChange).toMatchObject({ to: "node tools/lint.mjs", passed: "node tools/lint.mjs", measured: "bootstrap", files: [".ai/manifest.yaml"] });
    expect(bootstrapVerifyNote(verdict.gateChange!)).toMatch(/^Verified against the gate this lane DECLARED \(bootstrap\):/);
  }, 60_000);

  it("the same bootstrap over a MODIFIED tools/lint.mjs is void — a body can change under a name", async () => {
    const { verdict } = await laneOver(
      { ...BASE, "tools/lint.mjs": "process.exit(1);\n" },
      { ".ai/manifest.yaml": manifest("node tools/lint.mjs"), "tools/lint.mjs": "console.log('ok');\n" },
      skipped,
    );
    expect(verdict.void).toBe(true);
    expect(verdict.paths).toEqual(["tools/lint.mjs"]);
    expect(verdict.reason).toContain("verify-command, modified");
    expect(verdict.gateChange).toBeUndefined();
  }, 60_000);

  it("a vacuous first gate is void, and nothing is run", async () => {
    const { verdict, run } = await laneOver(BASE, { ".ai/manifest.yaml": manifest("echo ok") }, skipped);
    expect(run).not.toHaveBeenCalled();
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toContain("checks nothing");
  });
});
