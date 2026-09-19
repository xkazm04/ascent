// The autopilot's consent gate. The spawn path itself is exercised end-to-end by a real run (it is
// a subprocess wrapper, and mocking spawn would test the mock); what MUST be pinned is that the
// agent runner refuses without the explicit opt-in — an auto-editing agent must never be a default.

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_MODEL, autopilotEnabled, resolveAgentConfig, runClaudeAgent } from "@/lib/local/agent";
import { parseAgentEnvelope } from "@/lib/local/agent-envelope";
import { killProcessTree } from "@/lib/local/kill-tree";

// THE ONE MOCKED SEAM. The spawn path is otherwise exercised by a real run (mocking a subprocess to
// test a subprocess wrapper tests the mock) — but the STOP path cannot be: it has to be provoked
// from outside, mid-session, and the thing it must reach is a process tree. So the child is faked
// and the kill helper is spied; kill-tree.test.ts pins what the helper itself does.
const spawned = vi.hoisted(() => ({ last: null as FakeChildLike | null }));
interface FakeChildLike extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: (s: string) => void; end: () => void };
  kill: (sig?: string) => void;
}
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("autopilotEnabled", () => {
  it("is OFF by default", () => {
    vi.stubEnv("ASCENT_AUTOPILOT", "");
    expect(autopilotEnabled()).toBe(false);
  });

  it("requires the explicit flag", () => {
    vi.stubEnv("ASCENT_AUTOPILOT", "1");
    // Suite runs non-production, so cliProviderAllowed() is true and the flag is the deciding input.
    expect(autopilotEnabled()).toBe(true);
  });

  it("stays OFF on a managed-cloud production build even with the flag set", () => {
    vi.stubEnv("ASCENT_AUTOPILOT", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ASCENT_SELF_HOSTED", "0");
    expect(autopilotEnabled()).toBe(false);
  });
});

describe("runClaudeAgent consent refusal", () => {
  it("refuses to spawn anything when the flag is off, with the fix in the message", async () => {
    vi.stubEnv("ASCENT_AUTOPILOT", "");
    const r = await runClaudeAgent({ cwd: process.cwd(), prompt: "noop" });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("ASCENT_AUTOPILOT=1");
  });
});

describe("resolveAgentConfig — what a run is ACTUALLY armed with", () => {
  // Resolved once at arm time and persisted, because a row recording the raw pick would read `null`
  // for every default run — i.e. "whatever CLAUDE_MODEL was that day", the one fact the outcome
  // ledger needs and the only one an env var cannot recover afterwards.

  // The env name is deliberately NOT `CLAUDE_EFFORT`: the Claude Code harness sets that itself in the
  // environment it gives child processes, so a self-hosted Ascent started from inside a session would
  // have inherited an effort level nobody chose. This suite caught it (see agent.ts).
  it("prefers the operator's pick over the deployment's env", () => {
    vi.stubEnv("CLAUDE_MODEL", "sonnet");
    vi.stubEnv("ASCENT_AGENT_EFFORT", "low");
    expect(resolveAgentConfig({ model: "opus", effort: "high" })).toEqual({ model: "opus", effort: "high" });
  });

  it("falls back to the env when nothing was picked", () => {
    vi.stubEnv("CLAUDE_MODEL", "claude-sonnet-4-6");
    vi.stubEnv("ASCENT_AGENT_EFFORT", "medium");
    // An env-pinned model id is a deployment decision, so it is honoured verbatim even though the
    // PICKER cannot express it — the picker's closed list guards the request body, not the env.
    expect(resolveAgentConfig(null)).toEqual({ model: "claude-sonnet-4-6", effort: "medium" });
  });

  it("falls back to the built-in model, and to NO effort at all, when the env is silent", () => {
    vi.stubEnv("CLAUDE_MODEL", "");
    vi.stubEnv("ASCENT_AGENT_EFFORT", "");
    // Null effort is not a level: `--effort` is then not passed, so a CLI without the flag is
    // unaffected by this feature existing.
    expect(resolveAgentConfig({})).toEqual({ model: DEFAULT_AGENT_MODEL, effort: null });
  });

  it("ignores a pick that is not on the closed list rather than passing it to a shell", () => {
    vi.stubEnv("CLAUDE_MODEL", "sonnet");
    vi.stubEnv("ASCENT_AGENT_EFFORT", "");
    expect(resolveAgentConfig({ model: "opus; rm -rf /", effort: "ludicrous" })).toEqual({
      model: "sonnet",
      effort: null,
    });
  });
});

describe("parseAgentEnvelope — the measurements the process boundary used to drop", () => {
  // The whole `claude -p --output-format json` envelope, as a table. Pure: no subprocess, and no mock
  // of one. Before this existed the close handler read `.result`/`.is_error`/`.subtype` and threw the
  // rest away, so every numeric expectation below was `undefined` on the previous commit.
  const opts = { fallbackModel: "sonnet", exitCode: 0, stderr: "" };

  it("reads cost, tokens, turns, duration, session and model off a full envelope", () => {
    const env = parseAgentEnvelope(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Resolved two follow-ups.",
        session_id: "sess_abc",
        model: "claude-opus-4-6",
        num_turns: 4,
        duration_ms: 183_402,
        total_cost_usd: 0.6231,
        usage: { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 40_000 },
      }),
      opts,
    );
    expect(env.ok).toBe(true);
    expect(env.summary).toBe("Resolved two follow-ups.");
    expect(env.model).toBe("claude-opus-4-6");
    // MICRO-CENTS: $0.6231 = 62.31¢ = 62_310_000 micro-cents. An integer, so a 0.4¢ session is not
    // rounded to zero; every display divides.
    expect(env.costMicros).toBe(62_310_000);
    expect(env.inputTokens).toBe(1200);
    expect(env.outputTokens).toBe(800);
    expect(env.cacheReadTokens).toBe(40_000);
    expect(env.turns).toBe(4);
    expect(env.durationMs).toBe(183_402);
    expect(env.sessionId).toBe("sess_abc");
  });

  it("distinguishes a REPORTED zero cost from an absent one — 0 is a measurement, absent is not", () => {
    expect(parseAgentEnvelope(JSON.stringify({ result: "ok", total_cost_usd: 0 }), opts).costMicros).toBe(0);
    expect(parseAgentEnvelope(JSON.stringify({ result: "ok" }), opts).costMicros).toBeNull();
  });

  it("nulls every token count when `usage` is absent, rather than zeroing them", () => {
    const env = parseAgentEnvelope(JSON.stringify({ result: "ok", total_cost_usd: 0.01 }), opts);
    expect(env.inputTokens).toBeNull();
    expect(env.outputTokens).toBeNull();
    expect(env.cacheReadTokens).toBeNull();
    expect(env.turns).toBeNull();
  });

  it("keeps the cost of a FAILED session — a failure that burned $2 is the ledger's key row", () => {
    const env = parseAgentEnvelope(
      JSON.stringify({ is_error: true, subtype: "error_max_turns", result: "hit the turn cap", total_cost_usd: 2, num_turns: 30 }),
      opts,
    );
    expect(env.ok).toBe(false);
    expect(env.summary).toContain("error_max_turns");
    expect(env.costMicros).toBe(200_000_000);
    expect(env.turns).toBe(30);
  });

  it("falls back to the model we ASKED for when the envelope does not name one", () => {
    expect(parseAgentEnvelope(JSON.stringify({ result: "ok" }), opts).model).toBe("sonnet");
    // …and takes a single-key `modelUsage` map, the CLI's other encoding. Two keys is two models and
    // has no single honest answer, so it falls back rather than picking one.
    expect(parseAgentEnvelope(JSON.stringify({ result: "ok", modelUsage: { "claude-haiku-4-6": {} } }), opts).model).toBe(
      "claude-haiku-4-6",
    );
    expect(parseAgentEnvelope(JSON.stringify({ result: "ok", modelUsage: { a: {}, b: {} } }), opts).model).toBe("sonnet");
  });

  it("turns non-JSON stdout into a failed session with every measurement null, never a throw", () => {
    const env = parseAgentEnvelope("command not found", { fallbackModel: "sonnet", exitCode: 127, stderr: "" });
    expect(env.ok).toBe(false);
    expect(env.summary).toContain("without a JSON envelope");
    expect(env.costMicros).toBeNull();
    expect(env.model).toBeNull();
    expect(env.sessionId).toBeNull();
  });

  it("refuses a non-finite cost rather than storing NaN as a number", () => {
    expect(parseAgentEnvelope(JSON.stringify({ result: "ok", total_cost_usd: "not-a-number" }), opts).costMicros).toBeNull();
  });
});

describe("THE STOP REACHES THE PROCESS", () => {
  // Measured on the host that wrote this (win32, 2026-09-04): a real grandchild behind a
  // `shell: true` parent survives `child.kill()`. A stopped run used to free the org's slot in
  // ~2.5 min and leave that session running, unmonitored, until its own timer — up to 90 minutes.
  const armed = () => {
    vi.stubEnv("ASCENT_AUTOPILOT", "1");
    spawned.last = null;
    vi.mocked(killProcessTree).mockClear();
  };

  it("kills the process TREE on abort and settles with what the kill confirmed", async () => {
    armed();
    const cut = new AbortController();
    const p = runClaudeAgent({ cwd: process.cwd(), prompt: "work", timeoutMs: 60_000, signal: cut.signal });
    expect(spawned.last).not.toBeNull();

    cut.abort();
    const r = await p;

    // The helper, with the child's pid — not `child.kill()` alone, which only signals the shell.
    expect(killProcessTree).toHaveBeenCalledWith(4242);
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("Agent session stopped by the operator");
    // HONESTY: the outcome of the kill rides in the summary the lane logs. No schema change.
    expect(r.summary).toContain("agent process terminated (pid 4242)");
  });

  it("quotes the watchdog's own reason when the abort carries one", async () => {
    armed();
    const cut = new AbortController();
    const p = runClaudeAgent({ cwd: process.cwd(), prompt: "work", timeoutMs: 60_000, signal: cut.signal });
    cut.abort(new Error("the run was stopped while the agent session was in flight"));
    const r = await p;
    expect(r.summary).toContain("the run was stopped while the agent session was in flight");
  });

  it("settles ONCE — a close arriving after the abort cannot rewrite the outcome", async () => {
    armed();
    const cut = new AbortController();
    const p = runClaudeAgent({ cwd: process.cwd(), prompt: "work", timeoutMs: 60_000, signal: cut.signal });
    cut.abort();
    const r = await p;
    spawned.last?.stdout.emit("data", Buffer.from(JSON.stringify({ result: "all done" })));
    spawned.last?.emit("close", 0);
    await Promise.resolve();
    // Same settled value, not the envelope that arrived afterwards.
    expect(await p).toBe(r);
    expect(r.summary).not.toContain("all done");
  });

  it("does not spawn at all when the signal is ALREADY aborted", async () => {
    armed();
    const r = await runClaudeAgent({ cwd: process.cwd(), prompt: "work", signal: AbortSignal.abort() });
    expect(spawned.last).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.summary).toContain("no session was started");
  });

  it("leaves the TIMER path's sentence byte-identical — and now kills the tree there too", async () => {
    armed();
    vi.useFakeTimers();
    try {
      const p = runClaudeAgent({ cwd: process.cwd(), prompt: "work", timeoutMs: 60_000 });
      await vi.advanceTimersByTimeAsync(60_001);
      const r = await p;
      // The exact sentence every session before this change ended with. Settling frees the lane;
      // the kill is in addition to it, never instead of it.
      expect(r).toEqual({ ok: false, summary: "Agent session exceeded 1 min and was stopped." });
      expect(killProcessTree).toHaveBeenCalledWith(4242);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still settles from the CLI's own envelope when nobody aborts", async () => {
    armed();
    const p = runClaudeAgent({ cwd: process.cwd(), prompt: "work", timeoutMs: 60_000 });
    spawned.last?.stdout.emit("data", Buffer.from(JSON.stringify({ result: "did the thing" })));
    spawned.last?.emit("close", 0);
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.summary).toContain("did the thing");
    expect(killProcessTree).not.toHaveBeenCalled();
  });
});
