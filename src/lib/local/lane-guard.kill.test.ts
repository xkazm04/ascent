// THE GUARD'S COMMAND ENDS AS A TREE: run for real against `node` (a parent behind the shell, and a
// grandchild behind the parent, which is the shape of `cmd.exe` -> `npm` -> `vitest` -> its forks).
//
// MEASURED 2026-10-09 on the infinite-cycles rig: the old `child.kill()` ended only the shell, and two
// `npm test` trees outlived their timeout by over an hour (about 23 GB between them). These cases pin
// that the GRANDCHILD dies on the timeout and on the lane's end, and that a sibling lane's command in a
// different worktree is left alone.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgetVerifyBaseline, runVerifyCommand, stopVerifyCommands } from "./lane-guard";

let root: string;
const spawned: number[] = [];

const PARENT =
  "const { spawn } = require('node:child_process');\n" +
  "spawn(process.execPath, ['grandchild.js'], { stdio: 'ignore' });\n" +
  "setInterval(() => {}, 1000);\n";
const GRANDCHILD = "require('node:fs').writeFileSync('grandchild.pid', String(process.pid));\nsetInterval(() => {}, 1000);\n";

function lane(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "parent.js"), PARENT, "utf8");
  writeFileSync(join(dir, "grandchild.js"), GRANDCHILD, "utf8");
  return dir;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
}

async function grandchildPid(dir: string): Promise<number> {
  const file = join(dir, "grandchild.pid");
  for (let i = 0; i < 100 && !existsSync(file); i++) await sleep(100);
  const pid = Number(readFileSync(file, "utf8").trim());
  spawned.push(pid);
  return pid;
}

async function goneWithin(pid: number, ms = 5_000): Promise<boolean> {
  for (let t = 0; t < ms; t += 100) {
    if (!alive(pid)) return true;
    await sleep(100);
  }
  return !alive(pid);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ascent-guard-kill-"));
});

afterAll(() => {
  // A failing case must not become the leak it tests for.
  for (const pid of spawned) {
    try {
      if (alive(pid)) process.kill(pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("runVerifyCommand ends the whole process tree", () => {
  it("on TIMEOUT: the grandchild behind the shell dies, and the run says it timed out", async () => {
    const dir = lane("timeout");
    const run = runVerifyCommand(dir, "node parent.js", 4_000);
    const pid = await grandchildPid(dir);
    expect(alive(pid)).toBe(true);

    const r = await run;
    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(r.output).toContain("exceeded");
    expect(await goneWithin(pid)).toBe(true);
    expect(await stopVerifyCommands(dir)).toBe(0);
  }, 30_000);

  it("on the LANE'S END: forgetting one worktree ends its command tree and leaves another worktree's alone", async () => {
    const a = lane("lane-a");
    const b = lane("lane-b");
    const runA = runVerifyCommand(a, "node parent.js", 120_000);
    const runB = runVerifyCommand(b, "node parent.js", 120_000);
    const pidA = await grandchildPid(a);
    const pidB = await grandchildPid(b);

    await forgetVerifyBaseline(a);
    const rA = await runA;
    expect(rA).toMatchObject({ ok: false, timedOut: false });
    expect(rA.output).toContain("lane ended");
    expect(await goneWithin(pidA)).toBe(true);
    expect(alive(pidB)).toBe(true);

    expect(await stopVerifyCommands(b)).toBe(1);
    expect((await runB).ok).toBe(false);
    expect(await goneWithin(pidB)).toBe(true);
  }, 30_000);

  it("an ordinary exit is still an ordinary exit, and leaves nothing registered", async () => {
    const dir = lane("exit");
    const r = await runVerifyCommand(dir, "node -e \"process.exit(0)\"", 30_000);
    expect(r).toMatchObject({ ok: true, timedOut: false });
    expect(await stopVerifyCommands(dir)).toBe(0);
  }, 30_000);
});
