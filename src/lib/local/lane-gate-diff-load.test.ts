// THE GUARD'S EVIDENCE, read off a REAL repository: a temp git repo with a base commit and a lane
// commit on top, so the status read, the added-text read and the before/after ladder are all exercised
// end to end through git rather than through a mock that agrees with whatever the code expects.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "@/lib/local/git";
import { checkGateDiff } from "@/lib/local/lane-gate-diff";
import { readGateDiffEvidence } from "@/lib/local/lane-gate-diff-load";

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

/** A repo at `base`, then one lane commit applying `lane`. Returns what the loop-lane call site has. */
async function laneOver(base: Record<string, string>, lane: Record<string, string | null>) {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-diff-"));
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
  const changedPaths = sh(dir, "diff", "--name-only", `${before}..HEAD`).split("\n").filter(Boolean);
  const git = (args: readonly string[]) => runGit(dir, args);
  const evidence = await readGateDiffEvidence({ git, dir, before, changedPaths });
  return { changedPaths, evidence, verdict: checkGateDiff(changedPaths, evidence) };
}

const PKG = JSON.stringify({ name: "g", scripts: { test: "vitest run", "test:smoke": "vitest run smoke" } });

describe("readGateDiffEvidence over a real lane commit", () => {
  it("acceptance 1: new tests + a new CI workflow on a repo with neither LAND (not void)", async () => {
    const { verdict, evidence } = await laneOver(
      { "src/game.ts": "export const x = 1;\n" },
      {
        "src/game.test.ts": 'import { it } from "vitest";\nit("x", () => {});\n',
        "tests/test_rules.py": "def test_rules():\n    assert True\n",
        ".github/workflows/ci.yml": "on: push\njobs: {}\n",
      },
    );
    expect(evidence.statuses).toMatchObject({ "src/game.test.ts": "A", ".github/workflows/ci.yml": "A" });
    expect(verdict.void).toBe(false);
  });

  it("acceptance 2: editing an existing test is void exactly as before", async () => {
    const { verdict } = await laneOver(
      { "src/game.test.ts": "it('a', () => expect(1).toBe(1));\n" },
      { "src/game.test.ts": "it.skip('a', () => expect(1).toBe(1));\n" },
    );
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toContain("test-file, modified");
  });

  it("a MOVED test is void through its delete (--no-renames)", async () => {
    const body = "it('a', () => expect(1).toBe(1));\n";
    const { verdict } = await laneOver({ "src/old.test.ts": body }, { "src/old.test.ts": null, "src/new.test.ts": body });
    expect(verdict.void).toBe(true);
    expect(verdict.paths).toEqual(["src/old.test.ts"]);
  });

  it("an added test that ends the run is caught from its committed text", async () => {
    const { verdict } = await laneOver({ "go.sum": "" }, { "engine/main_test.go": "package engine\nfunc TestMain(m *testing.M) { os.Exit(0) }\n" });
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toContain("end the test run early");
  });

  it("acceptance 3a: a CLAUDE.md edit that leaves the resolved command alone is NOT void", async () => {
    const { verdict, evidence } = await laneOver(
      { "package.json": PKG, "CLAUDE.md": "# Game\nRun `npm test` before pushing.\n" },
      { "CLAUDE.md": "# Game\n\nArchitecture: ECS. Rendering lives in src/render.\n\nRun `npm test` before pushing.\n" },
    );
    expect(evidence.verifyLadder?.before.map((r) => r.command)).toEqual(evidence.verifyLadder?.after.map((r) => r.command));
    expect(verdict.void).toBe(false);
  });

  it("acceptance 3b: a CLAUDE.md edit that changes the declared test command is void, old -> new", async () => {
    const { verdict } = await laneOver(
      { "package.json": PKG, "CLAUDE.md": "# Game\nRun `npm test` before pushing.\n" },
      { "CLAUDE.md": "# Game\nRun `npm run test:smoke` before pushing.\n" },
    );
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toMatch(/`npm test`.* -> `npm run test:smoke`/);
  });

  it("an added .ai/manifest.yaml wiring a ciHardPass where none resolved is void", async () => {
    const manifest = [
      "schema: ai-manifest",
      "schemaVersion: 0.1.0",
      "capabilities:",
      '  test: { command: "npm test", verified: true }',
      "controls:",
      "  ciHardPass: [test]",
      "",
    ].join("\n");
    const { verdict } = await laneOver({ "src/game.ts": "export {};\n" }, { ".ai/manifest.yaml": manifest });
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toContain("(none resolved) -> `npm test`");
  });

  it("a modified package.json voids even with no command change — a script body can move", async () => {
    const { verdict } = await laneOver(
      { "package.json": PKG },
      { "package.json": JSON.stringify({ name: "g", scripts: { test: "vitest run --passWithNoTests", "test:smoke": "x" } }) },
    );
    expect(verdict.void).toBe(true);
    expect(verdict.reason).toContain("verify-command, modified");
  });

  it("reads nothing at all when no path is on the scoring surface", async () => {
    const calls: (readonly string[])[] = [];
    const evidence = await readGateDiffEvidence({
      git: async (a) => (calls.push(a), { ok: true, stdout: "" }),
      dir: "C:/nowhere",
      before: "abc",
      changedPaths: ["src/a.ts", "README.md"],
    });
    expect(evidence).toEqual({});
    expect(calls).toEqual([]);
  });
});
