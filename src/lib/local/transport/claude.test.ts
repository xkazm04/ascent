// THE CLAUDE TRANSPORT'S TWO PURE SURFACES — the argument vector and the spawn environment — pinned
// against LITERALS.
//
// A literal, not a re-derivation. The regression this file exists to catch is "adding a second
// transport quietly changed what the first one runs", and a test that rebuilds the expected argv from
// the same builder would pass no matter what both sides did together. The arrays below were copied
// from `agent.ts` as it stood BEFORE the transport registry existed.

import { describe, expect, it } from "vitest";
import {
  CLAUDE_LOCAL_ENV_KEYS,
  CLAUDE_STRIPPED_ENV_KEYS,
  claudeArgs,
  claudeHostedTiming,
  claudeLocalTiming,
  LOCAL_REQUEST_TIMEOUT_MS,
  claudeProfile,
  claudeSpawnEnv,
} from "@/lib/local/transport/claude";
import type { LocalEndpoint } from "@/lib/local/transport/run";

const UUID = "1f2e3d4c-5b6a-4798-8a9b-0c1d2e3f4a5b";
const OTHER = "9a8b7c6d-5e4f-4321-8fed-cba987654321";

describe("claudeArgs — byte-identical to the argv every lane runs today", () => {
  it("builds the EDITING session's vector, literally", () => {
    expect(claudeArgs({ model: "sonnet" })).toEqual([
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

  it("builds the PLANNING session's vector, literally — allowlist as ONE token", () => {
    // One token with no spaces, because `shell: true` re-parses argv on Windows.
    expect(claudeArgs({ model: "opus", permission: "plan" })).toEqual([
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
    ]);
  });

  it("appends --effort ONLY when a level was chosen, and after the model", () => {
    expect(claudeArgs({ model: "sonnet", effort: "high" }).slice(-4)).toEqual(["--model", "sonnet", "--effort", "high"]);
    expect(claudeArgs({ model: "sonnet", effort: null })).not.toContain("--effort");
    expect(claudeArgs({ model: "sonnet", effort: "" })).not.toContain("--effort");
  });

  it("prefers --resume over --session-id, exactly as the lane's minor execution relies on", () => {
    expect(claudeArgs({ model: "sonnet", sessionId: UUID, resumeSessionId: OTHER }).slice(-2)).toEqual(["--resume", OTHER]);
    expect(claudeArgs({ model: "sonnet", sessionId: UUID }).slice(-2)).toEqual(["--session-id", UUID]);
  });

  it("DROPS a malformed session id rather than failing the session", () => {
    // A resume that cannot be honoured degrades to a fresh session — what every lane before resuming
    // existed ran. Failing instead would kill a session over a stale caller's bad id.
    const args = claudeArgs({ model: "sonnet", resumeSessionId: "not-a-uuid; rm -rf /" });
    expect(args).not.toContain("--resume");
    expect(args).toEqual(claudeArgs({ model: "sonnet" }));
  });

  it("puts the endpoint NOWHERE in argv — a local arm differs only in its environment", () => {
    // The property that makes the bake-off a measurement of the MODEL rather than of two different
    // invocations: same binary, same flags, different socket.
    expect(claudeArgs({ model: "sonnet" }).join(" ")).not.toMatch(/localhost|http|11434/);
  });
});

describe("claudeSpawnEnv", () => {
  const endpoint: LocalEndpoint = {
    baseUrl: "http://localhost:11434",
    model: "qwen3.8:27b",
    contextTokens: 65_536,
  };

  it("strips the three forbidden vars, with or without an endpoint", () => {
    const base = { ANTHROPIC_API_KEY: "sk-x", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", PATH: "/usr/bin" };
    for (const env of [claudeSpawnEnv(base), claudeSpawnEnv(base, { endpoint })]) {
      for (const k of CLAUDE_STRIPPED_ENV_KEYS) expect(env[k]).toBeUndefined();
      expect(env.PATH).toBe("/usr/bin");
    }
    // Pure: the caller's object is never touched.
    expect(base.ANTHROPIC_API_KEY).toBe("sk-x");
  });

  it("adds NOTHING when there is no endpoint — today's spawn, unchanged", () => {
    const env = claudeSpawnEnv({ PATH: "/usr/bin" });
    expect(env).toEqual({ PATH: "/usr/bin" });
  });

  it("writes EXACTLY the researched local block and no invented sixth variable", () => {
    const before = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-x" };
    const env = claudeSpawnEnv(before, { endpoint, agentMs: 5_400_000 });
    const added = Object.keys(env).filter((k) => !(k in before));
    expect(added.sort()).toEqual([...CLAUDE_LOCAL_ENV_KEYS].sort());
    expect(env.ANTHROPIC_BASE_URL).toBe("http://localhost:11434");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("ollama");
    // ALL THREE model pins: Claude Code routes background work to a Haiku id regardless of --model,
    // and an unpinned one asks the local server for a model it has never heard of.
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("qwen3.8:27b");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("qwen3.8:27b");
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("qwen3.8:27b");
    expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("65536");
    expect(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe("1");
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
    // ONE REQUEST's ceiling, not the session's — see the second test below for why they differ.
    expect(env.API_TIMEOUT_MS).toBe(String(LOCAL_REQUEST_TIMEOUT_MS));
    // …and the strip still holds inside the local block.
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("honours an explicit token", () => {
    expect(claudeSpawnEnv({}, { endpoint: { ...endpoint, token: "tok" } }).ANTHROPIC_AUTH_TOKEN).toBe("tok");
  });

  // THE REQUEST CEILING IS NOT THE SESSION CEILING, and this pins the gap rather than the number.
  //
  // It used to be the session band, on the reasoning that a local response is merely slow and the
  // session's own timer should be what ends a run. That reasoning is right about slowness and wrong
  // about failure: measured 2026-09-21, a session finished its work, its follow-up request errored
  // twice, and the session then sat silent for the rest of its 90-minute budget because a single
  // request was allowed to wait that long. A dead request has to die while someone is still watching.
  it("bounds ONE request well below the session band, so a dead request cannot hold a lane silent", () => {
    const requestMs = Number(claudeSpawnEnv({}, { endpoint }).API_TIMEOUT_MS);
    expect(requestMs).toBe(LOCAL_REQUEST_TIMEOUT_MS);
    expect(requestMs).toBeLessThan(claudeLocalTiming.agentMs);
    // Generous enough for one slow local turn: the slowest generation rate measured on this hardware
    // was 8.4 tok/s, so ten minutes is thousands of tokens, not a tight fit.
    expect(requestMs).toBeGreaterThanOrEqual(300_000);
  });

  it("uses the same request ceiling whatever the session band is, because they answer different questions", () => {
    const short = claudeSpawnEnv({}, { endpoint, agentMs: 600_000 }).API_TIMEOUT_MS;
    const long = claudeSpawnEnv({}, { endpoint, agentMs: 5_400_000 }).API_TIMEOUT_MS;
    expect(short).toBe(long);
  });
});

describe("the dated capability matrix", () => {
  it("carries a live-run witness with today's date and version in EVERY cell, or is null", () => {
    for (const [name, cell] of Object.entries(claudeProfile.caps)) {
      if (cell === null) continue; // unverified is allowed; a guess is not
      expect(cell.method, name).toBe("live-run");
      expect(cell.verifiedAt, name).toBe("2026-09-21");
      expect(cell.version, name).toBe("2.1.278");
      // THE UNIT OF VERIFICATION IS THE WHOLE INVOCATION: a flag's acceptance is position-dependent,
      // so a cell records the argv that was actually smoked, not the flag in isolation.
      expect(cell.invocation, name).toMatch(/^claude -p /);
    }
  });

  it("records the hosted band as today's three constants and the local band as a wider one", () => {
    expect(claudeProfile.timing).toBe(claudeHostedTiming);
    expect(claudeHostedTiming).toEqual({ agentMs: 1_200_000, planMs: 480_000, quietMs: 90_000 });
    for (const k of ["agentMs", "planMs", "quietMs"] as const) {
      expect(claudeLocalTiming[k], k).toBeGreaterThan(claudeHostedTiming[k]);
    }
  });

  it("does NOT mark the Claude transport zero-cost — a subscription seat reports real dollars", () => {
    expect(claudeProfile.zeroCost).toBe(false);
  });
});
