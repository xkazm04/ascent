// THE RUNNER, STREAMED. The child is faked (the same one mocked seam agent.test.ts uses): what is pinned
// here is the argv the session is armed with, the environment it inherits, the events it emits while it
// runs, and that the settled result is the envelope it always was.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentSpawnEnv, runClaudeAgent, type ClaudeAgentOptions } from "@/lib/local/agent";
import { parseAgentEnvelope } from "@/lib/local/agent-envelope";
import type { AgentStreamEvent } from "@/lib/local/runner-types";

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: (s: string) => void; end: () => void };
  kill: (sig?: string) => void;
}
const spawned = vi.hoisted(() => ({ last: null as FakeChild | null }));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  spawn: vi.fn(() => {
    const child = new EventEmitter() as FakeChild;
    child.pid = 4242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.kill = vi.fn();
    spawned.last = child;
    return child;
  }),
}));
vi.mock("@/lib/local/kill-tree", async (orig) => ({
  ...(await orig<typeof import("@/lib/local/kill-tree")>()),
  killProcessTree: vi.fn(async (pid: number | null | undefined) => ({ confirmed: true, note: "terminated", pid: pid ?? null })),
}));

const FIXTURE = readFileSync(join(__dirname, "__fixtures__", "claude-stream-2.1.276.jsonl"), "utf8");
const RESULT_LINE = FIXTURE.split("\n").find((l) => l.includes('"type":"result"'))!;
const argv = () => vi.mocked(spawn).mock.calls.at(-1)![1] as string[];
const spawnEnv = () => (vi.mocked(spawn).mock.calls.at(-1)![2] as { env: NodeJS.ProcessEnv }).env;

beforeEach(() => {
  vi.stubEnv("ASCENT_AUTOPILOT", "1");
  vi.mocked(spawn).mockClear();
  spawned.last = null;
});
afterEach(() => vi.unstubAllEnvs());

/** Start a session, stream `text` in `chunk`-sized Buffers, close it, and return what it settled with. */
async function session(text: string, chunk: number, extra: Partial<ClaudeAgentOptions> = {}) {
  const events: AgentStreamEvent[] = [];
  const p = runClaudeAgent({ cwd: "C:\\work\\acme-api", prompt: "work", timeoutMs: 60_000, onEvent: (e) => events.push(e), ...extra });
  const bytes = Buffer.from(text, "utf8");
  for (let i = 0; i < bytes.length; i += chunk) spawned.last!.stdout.emit("data", bytes.subarray(i, i + chunk));
  spawned.last!.emit("close", 0);
  return { r: await p, events };
}

describe("argv — streamed, and every earlier rule kept", () => {
  it("asks for stream-json with --verbose on an editing session", async () => {
    await session(RESULT_LINE, 100);
    expect(argv()).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--model", "sonnet"]);
  });

  it("keeps the read-only planning argv, the effort flag and the session ids", async () => {
    const id = "0f1e2d3c-4b5a-4968-8776-655443322110";
    await session(RESULT_LINE, 100, { permission: "plan", effort: "high", sessionId: id, model: "opus" });
    expect(argv()).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "plan",
      "--allowedTools",
      "Read,Grep,Glob",
      "--model",
      "opus",
      "--effort",
      "high",
      "--session-id",
      id,
    ]);
    await session(RESULT_LINE, 100, { resumeSessionId: id, sessionId: "not-a-uuid; rm -rf /" });
    expect(argv().slice(-2)).toEqual(["--resume", id]);
  });
});

describe("the spawn environment (live.md L2-F-02)", () => {
  it("strips the Claude Code session markers and the API key — a nested claude that inherits them produces nothing", async () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_ENTRYPOINT", "cli");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("KEEP_ME", "yes");
    await session(RESULT_LINE, 100);
    const env = spawnEnv();
    expect(env).not.toHaveProperty("CLAUDECODE");
    expect(env).not.toHaveProperty("CLAUDE_CODE_ENTRYPOINT");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env.KEEP_ME).toBe("yes");
  });

  it("returns a copy and leaves the server's own environment alone", () => {
    const base = { CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", PATH: "/bin" };
    expect(agentSpawnEnv(base)).toEqual({ PATH: "/bin" });
    expect(base.CLAUDECODE).toBe("1");
  });
});

describe("streaming without regressing the envelope", () => {
  it("emits the session's events AS IT RUNS and settles with the one-shot envelope, field for field", async () => {
    // 7-byte Buffers: lines and multi-byte characters alike are cut mid-way.
    const { r, events } = await session(FIXTURE, 7);
    expect(events.map((e) => e.kind)).toEqual(["read", "text", "result"]);
    expect(events[0]).toMatchObject({ path: "package.json", tool: "Read" });
    expect(r).toEqual(parseAgentEnvelope(RESULT_LINE, { fallbackModel: "sonnet", exitCode: 0, stderr: "" }));
    expect(r).not.toHaveProperty("errorText");
  });

  it("keeps a multi-byte character split across two chunks whole", async () => {
    const line = JSON.stringify({ type: "result", result: "hotovo — žluťoučký kůň", is_error: false });
    const { r } = await session(line, 3);
    expect(r.summary).toBe("hotovo — žluťoučký kůň");
  });

  it("still reads a ONE-SHOT json object — an older CLI or a test double — exactly as before", async () => {
    const { r } = await session(JSON.stringify({ result: "did the thing" }), 4);
    expect(r).toMatchObject({ ok: true, summary: "did the thing" });
  });

  it("falls back to the no-JSON sentence for a stream that never produced its result", async () => {
    const p = runClaudeAgent({ cwd: "C:\\work\\acme-api", prompt: "work", timeoutMs: 60_000 });
    spawned.last!.stdout.emit("data", Buffer.from('{"type":"system","subtype":"init"}\n'));
    spawned.last!.stderr.emit("data", Buffer.from("claude crashed"));
    spawned.last!.emit("close", 1);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.summary).toBe("Agent exited (1) without a JSON envelope: claude crashed");
    expect(r.errorText).toBe("claude crashed");
  });

  it("never lets a sink that throws end the session", async () => {
    const { r } = await session(FIXTURE, 64, {
      onEvent: () => {
        throw new Error("sink broke");
      },
    });
    expect(r.ok).toBe(true);
  });
});

describe("errorText on a failed session", () => {
  it("carries the CLI's own sentence, and the summary's first line carries it too", async () => {
    const limit = [
      JSON.stringify({ type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your session limit · resets 3pm" }] } }),
      JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "You've hit your session limit · resets 3pm", total_cost_usd: 0 }),
    ].join("\n");
    const { r } = await session(limit, 16);
    expect(r.ok).toBe(false);
    expect(r.errorText).toBe("You've hit your session limit · resets 3pm");
    expect(r.summary.split("\n")[0]).toContain("You've hit your session limit");
    // A failed session still reports its cost — a real zero here.
    expect(r.costMicros).toBe(0);
  });

  it("uses the stream's hint when the result itself says nothing", async () => {
    const quiet = [
      JSON.stringify({ type: "assistant", error: "rate_limit", message: { content: [{ type: "text", text: "Usage limit reached" }] } }),
      JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true }),
    ].join("\n");
    const { r } = await session(quiet, 16);
    expect(r.errorText).toBe("Usage limit reached");
    expect(r.summary).toBe("Agent error (error_during_execution): Usage limit reached");
  });
});
