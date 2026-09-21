// THE PI SPAWN DOOR: its argv, the provider file it generates, and the stop path.
//
// The argv and the config file are PURE and pinned against literals, not against a re-derivation of
// themselves — a test that rebuilds the vector it is checking passes whatever either side does.
//
// The STOP path is the one thing that cannot be proved by a real run: it has to be provoked from
// outside, mid-session, and the thing it must reach is a process tree. So the child is faked and the
// kill helper is spied here, exactly as `agent.test.ts` does for the Claude door; `kill-tree.test.ts`
// pins what the helper itself does. Everything else about Pi in this package was smoked live — see
// `pi-normalize.test.ts`, whose fixtures are two real 0.86.1 sessions.

import { EventEmitter } from "node:events";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { killProcessTree } from "@/lib/local/kill-tree";
import {
  PI_EDIT_TOOLS,
  PI_LOCAL_PROVIDER,
  PI_PLAN_TOOLS,
  piArgs,
  piModelsJson,
  piProfile,
  piSessionDir,
  runPiAgent,
} from "@/lib/local/transport/pi";

const spawned = vi.hoisted(() => ({
  last: null as FakeChildLike | null,
  args: null as { bin: string; argv: string[]; env: NodeJS.ProcessEnv; cwd?: string } | null,
}));
interface FakeChildLike extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: (s: string) => void; end: () => void };
  kill: (sig?: string) => void;
}
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  spawn: vi.fn((bin: string, argv: string[], o: { env: NodeJS.ProcessEnv; cwd?: string }) => {
    const child = new EventEmitter() as FakeChildLike;
    child.pid = 4242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.kill = vi.fn();
    spawned.last = child;
    spawned.args = { bin, argv, env: o.env, cwd: o.cwd };
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

afterEach(() => {
  vi.unstubAllEnvs();
});

const endpoint = { baseUrl: "http://localhost:11434/v1", model: "qwen3.8:27b", contextTokens: 65_536 };

describe("piArgs — pinned against a literal", () => {
  it("is the editing invocation that was smoked live on 0.86.1", () => {
    expect(piArgs({ model: "ascent-local/qwen3.8:27b" })).toEqual([
      "-p",
      "--mode",
      "json",
      "--model",
      "ascent-local/qwen3.8:27b",
      "-t",
      "read,bash,edit,write",
      "--thinking",
      "off",
      "--no-session",
    ]);
  });

  it("narrows the tool allowlist to `read` for the planning stance — Pi has no --permission-mode", () => {
    const args = piArgs({ model: "m", permission: "plan" });
    expect(args).toContain("-t");
    expect(args[args.indexOf("-t") + 1]).toBe(PI_PLAN_TOOLS);
    expect(PI_PLAN_TOOLS).toBe("read");
    expect(PI_EDIT_TOOLS).toBe("read,bash,edit,write");
  });

  it("CREATES with --session-id and RESUMES with --session — never Pi's interactive --resume", () => {
    const uuid = "0199f0aa-1111-7000-8000-000000000001";
    const created = piArgs({ model: "m", sessionId: uuid, sessionDir: "D:/s" });
    expect(created).toContain("--session-id");
    expect(created).toContain("--session-dir");
    expect(created).not.toContain("--no-session");

    const resumed = piArgs({ model: "m", resumeSessionId: uuid, sessionDir: "D:/s" });
    expect(resumed.slice(resumed.indexOf("--session"))).toEqual(["--session", uuid, "--session-dir", "D:/s"]);
    expect(resumed).not.toContain("--resume");
  });

  it("drops a session id that is not a UUID and falls back to an ephemeral session", () => {
    const args = piArgs({ model: "m", sessionId: "not; a uuid", sessionDir: "D:/s" });
    expect(args).not.toContain("--session-id");
    expect(args).toContain("--no-session");
  });
});

describe("piModelsJson — the endpoint as a generated provider entry", () => {
  const cfg = JSON.parse(piModelsJson(endpoint)) as {
    providers: Record<string, { baseUrl: string; api: string; apiKey: string; compat: Record<string, boolean>; models: { id: string; contextWindow: number; maxTokens: number; cost: Record<string, number> }[] }>;
  };
  const provider = cfg.providers[PI_LOCAL_PROVIDER]!;

  it("points at the armed endpoint over the OpenAI-compatible route", () => {
    expect(provider.baseUrl).toBe("http://localhost:11434/v1");
    expect(provider.api).toBe("openai-completions");
    expect(provider.models[0]!.id).toBe("qwen3.8:27b");
  });

  it("DECLARES the arm's context window — a 4096 default truncates the tool definitions", () => {
    expect(provider.models[0]!.contextWindow).toBe(65_536);
  });

  it("carries a placeholder key — a local server ignores its value but rejects its absence", () => {
    expect(provider.apiKey).toBe("ollama");
    expect(JSON.parse(piModelsJson({ ...endpoint, token: "secret" })).providers[PI_LOCAL_PROVIDER].apiKey).toBe("secret");
  });

  it("turns off the two OpenAI-compat features Ollama does not implement", () => {
    expect(provider.compat).toEqual({ supportsDeveloperRole: false, supportsReasoningEffort: false });
  });

  it("prices the model at zero — which is exactly why the normalizer refuses to read it back", () => {
    expect(provider.models[0]!.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(piProfile.zeroCost).toBe(true);
  });
});

describe("piProfile — every cell is a live run against a named version, or it is null", () => {
  it("carries no unverified cell", () => {
    for (const [name, cell] of Object.entries(piProfile.caps)) {
      if (cell === null) continue;
      expect(cell.method, name).toBe("live-run");
      expect(cell.version, name).toBe("0.86.1");
      expect(cell.verifiedAt, name).toBe("2026-09-21");
      expect(cell.invocation, name).toMatch(/^pi -p --mode json /);
    }
  });

  it("records the stances as the allowlists that were actually adopted", () => {
    expect(piProfile.caps.editStance?.value).toBe(`-t ${PI_EDIT_TOOLS}`);
    expect(piProfile.caps.planStance?.value).toBe(`-t ${PI_PLAN_TOOLS}`);
  });
});

describe("runPiAgent — consent and the stop path", () => {
  const armed = () => {
    vi.stubEnv("ASCENT_AUTOPILOT", "1");
    spawned.last = null;
    spawned.args = null;
    vi.mocked(killProcessTree).mockClear();
  };

  it("refuses without the explicit opt-in, and never spawns", async () => {
    vi.stubEnv("ASCENT_AUTOPILOT", "");
    spawned.last = null;
    const r = await runPiAgent({ cwd: process.cwd(), prompt: "work", endpoint });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("ASCENT_AUTOPILOT=1");
    expect(spawned.last).toBeNull();
  });

  it("does not spawn at all when the signal is ALREADY aborted", async () => {
    armed();
    const r = await runPiAgent({ cwd: process.cwd(), prompt: "work", endpoint, signal: AbortSignal.abort() });
    expect(spawned.last).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("no session was started");
  });

  it("refuses a model token a shell could re-parse", async () => {
    armed();
    const r = await runPiAgent({ cwd: process.cwd(), prompt: "work", endpoint: { ...endpoint, model: "q && rm -rf ." } });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("Invalid model");
    expect(spawned.last).toBeNull();
  });

  it("kills the process TREE on abort and settles with what the kill confirmed", async () => {
    armed();
    const cut = new AbortController();
    const p = runPiAgent({ cwd: process.cwd(), prompt: "work", endpoint, timeoutMs: 60_000, signal: cut.signal });
    expect(spawned.last).not.toBeNull();

    cut.abort();
    const r = await p;

    // The helper, with the child's pid — not `child.kill()` alone, which only signals the shell.
    expect(killProcessTree).toHaveBeenCalledWith(4242);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("Agent session stopped by the operator");
    expect(r.summary).toContain("agent process terminated (pid 4242)");
  });

  it("settles ONCE — a close arriving after the abort cannot rewrite the outcome", async () => {
    armed();
    const cut = new AbortController();
    const p = runPiAgent({ cwd: process.cwd(), prompt: "work", endpoint, timeoutMs: 60_000, signal: cut.signal });
    cut.abort();
    const r = await p;
    spawned.last?.emit("close", 0);
    await Promise.resolve();
    expect(await p).toBe(r);
  });

  it("puts the prompt on stdin and the endpoint in the child's OWN environment", async () => {
    armed();
    const cut = new AbortController();
    const p = runPiAgent({ cwd: process.cwd(), prompt: "the brief --with flag-shaped text", endpoint, signal: cut.signal });
    const call = spawned.args!;
    expect(call.argv).not.toContain("the brief --with flag-shaped text");
    expect(spawned.last!.stdin.write).toHaveBeenCalledWith("the brief --with flag-shaped text");
    // The endpoint is a generated config directory on THIS spawn — never a write into the operator's
    // own ~/.pi/agent, which two lanes armed at two endpoints would fight over.
    const dir = call.env.PI_CODING_AGENT_DIR!;
    expect(dir).toBeTruthy();
    expect(JSON.parse(readFileSync(`${dir}/models.json`, "utf8")).providers[PI_LOCAL_PROVIDER].baseUrl).toBe(endpoint.baseUrl);
    expect(call.argv[call.argv.indexOf("--model") + 1]).toBe(`${PI_LOCAL_PROVIDER}/qwen3.8:27b`);
    // Ambient network chatter off: a lane is not the place for an update check.
    expect(call.env.PI_OFFLINE).toBe("1");
    // The strip `agentSpawnEnv` applies still applies — a nested harness marker never reaches a child.
    expect(call.env.CLAUDECODE).toBeUndefined();

    cut.abort();
    await p;
    // The generated directory does not outlive the session it armed.
    expect(existsSync(dir)).toBe(false);
  });

  it("keeps the session store OUTSIDE the per-run config directory, so a resume can find it", () => {
    vi.stubEnv("ASCENT_PI_SESSION_DIR", "");
    expect(piSessionDir()).toContain("ascent-pi-sessions");
    vi.stubEnv("ASCENT_PI_SESSION_DIR", "D:/lanes/pi");
    expect(piSessionDir()).toBe("D:/lanes/pi");
  });

  it("folds a real Pi stream into the envelope on close, with a NULL cost", async () => {
    armed();
    const p = runPiAgent({ cwd: process.cwd(), prompt: "work", endpoint, timeoutMs: 60_000 });
    const lines = [
      { type: "session", version: 3, id: "0199f0aa-1111-7000-8000-000000000001", cwd: process.cwd() },
      { type: "turn_start" },
      { type: "tool_execution_start", toolCallId: "c1", toolName: "write", args: { path: "hello.txt", content: "hi" } },
      { type: "tool_execution_end", toolCallId: "c1", toolName: "write", result: { content: [{ type: "text", text: "ok" }] }, isError: false },
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Created hello.txt." }],
          model: "qwen3.8:27b",
          usage: { input: 1_000, output: 40, cacheRead: 0, cost: { total: 0 } },
          stopReason: "stop",
          timestamp: 1_789_989_916_006,
        },
      },
      { type: "agent_end" },
      { type: "agent_settled" },
    ];
    spawned.last!.stdout.emit("data", Buffer.from(`${lines.map((l) => JSON.stringify(l)).join("\n")}\n`));
    spawned.last!.emit("close", 0);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.summary).toBe("Created hello.txt.");
    expect(r.costMicros).toBeNull();
    expect(r.inputTokens).toBe(1_000);
    expect(r.outputTokens).toBe(40);
    expect(r.turns).toBe(1);
    // The wall clock is OURS: Pi reports no session duration at all.
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports a Pi failure that exited 0 as a failure, with Pi's own words", async () => {
    armed();
    const p = runPiAgent({ cwd: process.cwd(), prompt: "work", endpoint, timeoutMs: 60_000 });
    const lines = [
      { type: "session", version: 3, id: "0199f0aa-1111-7000-8000-000000000002", cwd: process.cwd() },
      { type: "turn_start" },
      { type: "auto_retry_end", success: false, attempt: 3, finalError: "Connection error." },
      { type: "agent_settled" },
    ];
    spawned.last!.stdout.emit("data", Buffer.from(`${lines.map((l) => JSON.stringify(l)).join("\n")}\n`));
    spawned.last!.emit("close", 0);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("Connection error.");
    expect(r.errorText).toBe("Connection error.");
  });
});

afterEach(() => {
  // Nothing should be left behind; this is belt to the cleanup inside the runner.
  try {
    rmSync(piSessionDir(), { recursive: true, force: true });
  } catch {
    // Never a test failure.
  }
});
