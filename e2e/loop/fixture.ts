// The fixture repository the loop suite iterates on.
//
// A real git repository on disk, created per run in the OS temp dir — not a checked-in folder and
// never the operator's own checkout. The loop's whole subject is a working copy: pairing verifies it
// with `git rev-parse`, the scan reads it with `git ls-files`, and a lane hangs a `git worktree` off
// it. A fake directory would fail at the first of those.
//
// What it deliberately does NOT contain is `.ai/manifest.yaml`. That absence is the input to rule 1
// of `proposeLaneKind` (src/lib/local/lane-kind.ts): a repo with no `.ai/` standard proposes a
// FOUNDATION lane, which installs the generated tree and commits it with no agent session at all.
// That is what makes the whole loop drivable in e2e — a backlog lane would spawn `claude -p`.

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** The owner/repo this fixture is mapped under. Not a real GitHub repo, and never looked up as one:
 *  every scan in this suite runs with `noAmbientToken`, from disk. */
export const FIXTURE_REPO = "ascent-e2e/loop-fixture";
/** Just the repo half — what the observatory's list row and the report link show. */
export const FIXTURE_NAME = "loop-fixture";

/** Enough of a project for the scan pipeline to produce a report with real signals in it. */
const FILES: Record<string, string> = {
  "README.md": [
    "# loop-fixture",
    "",
    "A tiny Node service used as the subject of Ascent's local-mode loop e2e suite.",
    "It exists to be scanned from disk, improved by a lane, and rescanned.",
    "",
    "## Commands",
    "",
    "- `npm test` — the unit suite",
    "- `npm run lint` — lint",
  ].join("\n"),
  "package.json": JSON.stringify(
    {
      name: "loop-fixture",
      version: "0.1.0",
      private: true,
      description: "Fixture service for the Ascent loop e2e suite.",
      scripts: { test: "node --test", lint: "echo lint", build: "echo build" },
    },
    null,
    2,
  ),
  "src/index.js": [
    "// The fixture's entire application surface.",
    "export function greet(name) {",
    "  if (!name) throw new Error('name is required');",
    "  return `hello, ${name}`;",
    "}",
  ].join("\n"),
  "src/index.test.js": [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { greet } from './index.js';",
    "",
    "test('greets', () => {",
    "  assert.equal(greet('world'), 'hello, world');",
    "});",
  ].join("\n"),
  ".github/workflows/ci.yml": [
    "name: ci",
    "on: [push, pull_request]",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - run: npm test",
  ].join("\n"),
  ".gitignore": "node_modules/\n",
};

/** Create the fixture repo and return its absolute, symlink-resolved path. */
export async function createFixtureRepo(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ascent-e2e-loop-")));
  for (const [rel, body] of Object.entries(FILES)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, `${body}\n`, "utf8");
  }
  await git(dir, ["init", "-b", "main"]);
  // Repo-local identity, so the lane's own `git commit` inside the worktree works on a machine with
  // no global user.name/user.email (a worktree inherits its repo's config).
  await git(dir, ["config", "user.email", "loop-e2e@ascent.invalid"]);
  await git(dir, ["config", "user.name", "Ascent Loop E2E"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "chore: the fixture repository"]);
  return dir;
}

/** Best-effort teardown. The loop leaves its `ascent/loop-*` branch behind by design; removing the
 *  whole temp tree takes the branch with it. */
export async function removeFixtureRepo(dir: string | null): Promise<void> {
  if (!dir) return;
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
}

/** Run git in the fixture repo. Throws on failure — a broken fixture is a broken test, not a finding. */
export async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd: dir, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return stdout;
}

/** The `ascent/loop-*` branches the engine left in the fixture repo — the run's deliverable. */
export async function loopBranches(dir: string): Promise<string[]> {
  const out = await git(dir, ["branch", "--list", "ascent/loop-*", "--format=%(refname:short)"]);
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

/** The single branch a one-lane run must have left. Throws with a readable reason when it did not —
 *  "the run produced no branch" is the finding, and an `undefined` slipping into a git argv is not. */
export async function theLoopBranch(dir: string): Promise<string> {
  const branches = await loopBranches(dir);
  const [branch] = branches;
  if (branches.length !== 1 || !branch) {
    throw new Error(`expected exactly one ascent/loop-* branch, found ${branches.length}: ${branches.join(", ")}`);
  }
  return branch;
}
