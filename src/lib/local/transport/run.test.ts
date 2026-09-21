// `runAgentVia` — the one door, proven not to have changed what was already behind it.
//
// THE ACCEPTANCE TEST OF THIS WHOLE PACKAGE is the first case: `runAgentVia("claude", opts)` with no
// endpoint must reach `spawn` with an argv byte-identical to the one `agent.ts` composed before the
// registry existed, asserted against a LITERAL. Every lane in the fleet goes through this call.

import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { killProcessTree } from "@/lib/local/kill-tree";
import { runAgentVia } from "@/lib/local/transport/run";
import { CLAUDE_LOCAL_ENV_KEYS, CLAUDE_STRIPPED_ENV_KEYS } from "@/lib/local/transport/claude";

interface FakeChildLike extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: (s: string) => void; end: () => void };
  kill: (sig?: string) => void;
}
const spawned = vi.hoisted(() => ({ last: null as FakeChildLike | null }));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  spawn: vi.fn(() => {
    const child = new EventEmitter() as FakeChildLike;
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
  killProcessTree: vi.fn(async (pid: number | null | undefined) => ({
    confirmed: true,
    note: `agent process terminated (pid ${pid})`,
    pid: pid ?? null,
  })),
}));

const armed = () => {
  vi.stubEnv("ASCENT_AUTOPILOT", "1");
  vi.stubEnv("CLAUDE_CLI_PATH", "");
  vi.stubEnv("CLAUDE_MODEL", "");
  spawned.last = null;
  vi.mocked(spawn).mockClear();
  vi.mocked(killProcessTree).mockClear();
};

/** The argv of the last spawn, and the env it was handed. */
const lastCall = () => {
  const call = vi.mocked(spawn).mock.calls.at(-1);
  if (!call) throw new Error("nothing was spawned");
  const [bin, args, options] = call as unknown as [string, string[], { env: NodeJS.ProcessEnv; cwd: string }];
  return { bin, args, env: options.env, cwd: options.cwd };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runAgentVia('claude') with no endpoint — today's spawn, byte for byte", () => {
  it("produces the EXACT argument vector every existing lane runs", () => {
    armed();
    void runAgentVia("claude", { cwd: process.cwd(), prompt: "work", model: "sonnet", timeoutMs: 60_000 });
    const { bin, args } = lastCall();
    expect(bin).toBe("claude");
    // Copied from `agent.ts` as it stood before the transport registry existed. A re-derivation here
    // would pass no matter what both sides did together; a literal cannot.
    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
      "--model",
      "sonnet",
    ]);
  });

  it("hands the child an environment with the three stripped vars gone and NO endpoint block", () => {
    armed();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-should-not-reach-the-child");
    vi.stubEnv("CLAUDECODE", "1");
    void runAgentVia("claude", { cwd: process.cwd(), prompt: "work", model: "sonnet", timeoutMs: 60_000 });
    const { env } = lastCall();
    for (const k of CLAUDE_STRIPPED_ENV_KEYS) expect(env[k], k).toBeUndefined();
    for (const k of CLAUDE_LOCAL_ENV_KEYS) expect(env[k], k).toBeUndefined();
  });

  it("writes the prompt to STDIN and never into argv — a brief contains flag-shaped text", () => {
    armed();
    void runAgentVia("claude", { cwd: process.cwd(), prompt: "--model evil", model: "sonnet", timeoutMs: 60_000 });
    const { args } = lastCall();
    expect(args.filter((a) => a === "--model")).toHaveLength(1);
    expect(spawned.last?.stdin.write).toHaveBeenCalledWith("--model evil");
  });
});

describe("runAgentVia('claude') with a local endpoint", () => {
  const endpoint = { baseUrl: "http://localhost:11434", model: "qwen3.8:27b", contextTokens: 65_536 };

  it("changes the ENVIRONMENT and nothing else — same binary, same flags", () => {
    armed();
    void runAgentVia("claude", { cwd: process.cwd(), prompt: "work", model: "sonnet", timeoutMs: 60_000, endpoint });
    const withEndpoint = lastCall();
    armed();
    void runAgentVia("claude", { cwd: process.cwd(), prompt: "work", model: "sonnet", timeoutMs: 60_000 });
    expect(withEndpoint.args).toEqual(lastCall().args);
    expect(withEndpoint.bin).toBe("claude");
  });

  it("carries exactly the researched block, and still omits the three stripped vars", () => {
    armed();
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-should-not-reach-the-child");
    vi.stubEnv("CLAUDE_CODE_ENTRYPOINT", "cli");
    void runAgentVia("claude", { cwd: process.cwd(), prompt: "work", model: "sonnet", timeoutMs: 60_000, endpoint });
    const { env } = lastCall();
    expect(env.ANTHROPIC_BASE_URL).toBe("http://localhost:11434");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("ollama");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("qwen3.8:27b");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("qwen3.8:27b");
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("qwen3.8:27b");
    expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("65536");
    expect(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe("1");
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
    // The session's own ceiling, so the CLIENT does not give up before the session timer can.
    expect(env.API_TIMEOUT_MS).toBe("60000");
    for (const k of CLAUDE_STRIPPED_ENV_KEYS) expect(env[k], k).toBeUndefined();
  });

  it("never writes any of it to process.env — two arms must coexist on one server", () => {
    armed();
    void runAgentVia("claude", { cwd: process.cwd(), prompt: "work", model: "sonnet", timeoutMs: 60_000, endpoint });
    for (const k of CLAUDE_LOCAL_ENV_KEYS) expect(process.env[k], k).toBeUndefined();
  });

  it("names the arm in the ceiling sentence AND in the structured attribution", async () => {
    armed();
    vi.useFakeTimers();
    try {
      const p = runAgentVia("claude", { cwd: process.cwd(), prompt: "work", model: "sonnet", timeoutMs: 60_000, endpoint });
      await vi.advanceTimersByTimeAsync(60_001);
      const r = await p;
      expect(r.summary).toBe("Agent session (claude → qwen3.8:27b) exceeded 1 min and was stopped.");
      expect(r.ceiling).toEqual({ kind: "session", transport: "claude", local: true, limitMs: 60_000 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the abort path still settles, and still reaps the tree", () => {
  it("kills the process TREE and resolves with the ceiling attributed to the lane", async () => {
    armed();
    const cut = new AbortController();
    const p = runAgentVia("claude", { cwd: process.cwd(), prompt: "work", timeoutMs: 60_000, signal: cut.signal });
    expect(spawned.last).not.toBeNull();
    cut.abort();
    const r = await p;
    expect(killProcessTree).toHaveBeenCalledWith(4242);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("agent process terminated (pid 4242)");
    // `kind: "lane"` and a NULL limit: the number that fired belongs to the watchdog, and restating
    // a figure this side never held would be an invention in a measurement column.
    expect(r.ceiling).toEqual({ kind: "lane", transport: "claude", local: false, limitMs: null });
  });

  it("refuses without the autopilot opt-in, through the registry as through the old door", async () => {
    vi.stubEnv("ASCENT_AUTOPILOT", "");
    spawned.last = null;
    const r = await runAgentVia("claude", { cwd: process.cwd(), prompt: "work" });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("ASCENT_AUTOPILOT=1");
    expect(spawned.last).toBeNull();
  });
});

describe("transport selection", () => {
  it("routes 'pi' away from the claude spawn entirely", async () => {
    armed();
    const r = await runAgentVia("pi", { cwd: process.cwd(), prompt: "work" });
    // WP2 owns the implementation; what MUST hold from here is that a pi arm never silently falls
    // through onto `claude` — that would run a lane on the wrong arm and record it under the right
    // name, which is the one failure a comparison cannot survive.
    expect(spawned.last).toBeNull();
    expect(r.ok).toBe(false);
  });
});
