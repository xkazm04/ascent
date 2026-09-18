// The install process seam, run for real against `node` (never a package manager): an exit code is
// reported as one, a timeout and an abort each END THE TREE and are reported as what they were — never
// as an ordinary non-zero exit, which would put the wrong sentence on a held lane.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnInstall } from "./lane-deps-spawn";

let dir: string;
const script = (name: string) => ({ command: "node", args: [join(dir, name)], env: { ASCENT_SPAWN_TEST: "on" } });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ascent-deps-spawn-"));
  writeFileSync(join(dir, "exit3.js"), "console.error('npm error 404 Not Found');\nprocess.exit(3);\n", "utf8");
  writeFileSync(join(dir, "env.js"), "console.log(process.env.ASCENT_SPAWN_TEST + ':' + (process.env.ANTHROPIC_API_KEY ?? 'stripped'));\n", "utf8");
  writeFileSync(join(dir, "hang.js"), "setInterval(() => {}, 1000);\n", "utf8");
});
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

describe("spawnInstall", () => {
  it("reports the exit code and the output", async () => {
    const r = await spawnInstall(script("exit3.js"), { cwd: dir, timeoutMs: 30_000 });
    expect(r).toMatchObject({ code: 3, timedOut: false, aborted: false, spawnError: null });
    expect(r.output).toContain("npm error 404 Not Found");
  });

  it("inherits the environment plus the command's own, minus ANTHROPIC_API_KEY", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test-not-for-a-dependency";
    try {
      const r = await spawnInstall(script("env.js"), { cwd: dir, timeoutMs: 30_000 });
      expect(r.output.trim()).toBe("on:stripped");
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("a timeout kills the process and is reported as a timeout", async () => {
    const r = await spawnInstall(script("hang.js"), { cwd: dir, timeoutMs: 400 });
    expect(r).toMatchObject({ code: null, timedOut: true, aborted: false });
  }, 30_000);

  it("an abort kills the process and is reported as an abort — and an already-aborted signal spawns nothing", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const r = await spawnInstall(script("hang.js"), { cwd: dir, timeoutMs: 30_000, signal: ac.signal });
    expect(r).toMatchObject({ code: null, timedOut: false, aborted: true });
    const again = await spawnInstall(script("exit3.js"), { cwd: dir, timeoutMs: 30_000, signal: ac.signal });
    expect(again).toEqual({ code: null, output: "", timedOut: false, aborted: true, spawnError: null });
  }, 30_000);
});
