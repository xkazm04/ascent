// Subscription-auth selection (agent-cli-transport subject): the child environment handed to spawn
// must NOT carry the tool's metered-billing key — the tools prefer a visible API key over the
// operator's seat session, so a leaked key silently converts every run from "free on the
// subscription" to a per-token invoice. The technique requires this pinned by a test that reads the
// environment the spawn door actually passes, not the one a call site thinks it built.

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";

const h = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: h.spawn }));

import { claudeCliTransport } from "./claude";
import { codexCliTransport } from "./codex";

/** Minimal fake ChildProcess (same shape as claude-cli.test.ts's): emits `stdout` then closes. */
function fakeChild(exitCode: number, stdout = "") {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter & { write: () => void; end: () => void; destroyed: boolean };
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = Object.assign(new EventEmitter(), { write: () => {}, end: () => {}, destroyed: false });
  child.kill = () => {};
  queueMicrotask(() => {
    if (stdout) child.stdout.emit("data", stdout);
    child.emit("close", exitCode);
  });
  return child;
}

function spawnedEnv(): NodeJS.ProcessEnv {
  const options = h.spawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
  return options.env;
}

afterEach(() => {
  vi.unstubAllEnvs();
  h.spawn.mockReset();
});

describe("claude adapter env strip (subscription auth)", () => {
  const envelope = JSON.stringify({ is_error: false, result: "hi" });

  it("strips ANTHROPIC_API_KEY from the child env while inheriting everything else", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-metered-key");
    vi.stubEnv("ASCENT_ENV_STRIP_SENTINEL", "still-here");
    h.spawn.mockImplementation(() => fakeChild(0, envelope));

    const res = await claudeCliTransport.run({ prompt: "hello", mode: "generate" });
    expect(res.ok).toBe(true);
    expect(res.text).toBe("hi");
    expect(h.spawn).toHaveBeenCalledTimes(1);
    const env = spawnedEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined(); // the strip — billing stays on the seat
    expect(env.ASCENT_ENV_STRIP_SENTINEL).toBe("still-here"); // a strip, not a scrub
  });

  it("runs generate in a neutral tmpdir cwd (no ambient project instructions)", async () => {
    h.spawn.mockImplementation(() => fakeChild(0, envelope));
    await claudeCliTransport.run({ prompt: "hello", mode: "generate", cwd: "C:/some/project" });
    const options = h.spawn.mock.calls[0][2] as { cwd: string };
    expect(options.cwd).toBe(tmpdir()); // generate ignores cwd by contract
  });

  it("refuses a shell-metacharacter model before the spawn (shell:true re-parses argv)", async () => {
    const res = await claudeCliTransport.run({ prompt: "x", mode: "generate", model: "sonnet; rm -rf x" });
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe("config");
    expect(h.spawn).not.toHaveBeenCalled();
  });
});

describe("codex adapter env strip (subscription auth)", () => {
  const jsonl = '{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}';

  it("strips OPENAI_API_KEY from the child env so the run bills to the ChatGPT plan", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-metered-key");
    vi.stubEnv("ASCENT_ENV_STRIP_SENTINEL", "still-here");
    h.spawn.mockImplementation(() => fakeChild(0, jsonl));

    const res = await codexCliTransport.run({ prompt: "hello", mode: "generate" });
    expect(res.ok).toBe(true);
    expect(res.text).toBe("OK");
    const env = spawnedEnv();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ASCENT_ENV_STRIP_SENTINEL).toBe("still-here");
  });

  it("passes the OS read-only sandbox flag and reads the prompt from stdin, not argv", async () => {
    h.spawn.mockImplementation(() => fakeChild(0, jsonl));
    await codexCliTransport.run({ prompt: 'quote " and --flag-shaped text', mode: "generate" });
    const args = h.spawn.mock.calls[0][1] as string[];
    expect(args).toContain("read-only");
    expect(args[args.length - 1]).toBe("-"); // stdin prompt marker
    expect(args.join(" ")).not.toContain("flag-shaped"); // never on the argument vector
  });

  it("readonly-scan runs in the caller's cwd; generate stays in tmpdir", async () => {
    h.spawn.mockImplementation(() => fakeChild(0, jsonl));
    await codexCliTransport.run({ prompt: "x", mode: "readonly-scan", cwd: "C:/some/project" });
    expect((h.spawn.mock.calls[0][2] as { cwd: string }).cwd).toBe("C:/some/project");
  });

  it("edit mode is a typed not-supported error, never a silent downgrade — and never spawns", async () => {
    const res = await codexCliTransport.run({ prompt: "x", mode: "edit", cwd: "C:/some/project" });
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe("not-supported");
    expect(res.error?.message).toMatch(/autopilot/);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("an error-only stream is a typed failure, not an empty success", async () => {
    h.spawn.mockImplementation(() => fakeChild(0, '{"type":"turn.failed","error":{"message":"usage limit reached"}}'));
    const res = await codexCliTransport.run({ prompt: "x", mode: "generate" });
    expect(res.ok).toBe(false);
    expect(res.error?.kind).toBe("envelope");
    expect(res.error?.message).toMatch(/usage limit reached/);
  });
});
