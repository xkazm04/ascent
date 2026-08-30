// The autopilot's consent gate. The spawn path itself is exercised end-to-end by a real run (it is
// a subprocess wrapper, and mocking spawn would test the mock); what MUST be pinned is that the
// agent runner refuses without the explicit opt-in — an auto-editing agent must never be a default.

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_MODEL, autopilotEnabled, resolveAgentConfig, runClaudeAgent } from "@/lib/local/agent";
import { parseAgentEnvelope } from "@/lib/local/agent-envelope";

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
