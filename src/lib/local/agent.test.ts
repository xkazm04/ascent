// The autopilot's consent gate. The spawn path itself is exercised end-to-end by a real run (it is
// a subprocess wrapper, and mocking spawn would test the mock); what MUST be pinned is that the
// agent runner refuses without the explicit opt-in — an auto-editing agent must never be a default.

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_MODEL, autopilotEnabled, resolveAgentConfig, runClaudeAgent } from "@/lib/local/agent";

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
