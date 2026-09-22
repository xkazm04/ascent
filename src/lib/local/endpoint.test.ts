// IS THIS ARM HALF LOCAL, AND WHAT DOES IT TALK TO (spark local-model-lanes, WP11).
//
// The central capability of the feature — running a lane on a local model — is reachable only if
// something resolves a `LocalEndpoint`. These pin the rule itself, in one table, so "is this lane
// local?" cannot quietly acquire a second answer.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCAL_AGENT_CONTEXT,
  DEFAULT_LOCAL_AGENT_TOKEN,
  DEFAULT_LOCAL_AGENT_URL,
  LOCAL_AGENT_CONTEXT_ENV,
  LOCAL_AGENT_TOKEN_ENV,
  LOCAL_AGENT_URL_ENV,
  __resetLocalContextWarning,
  isLocalHalf,
  resolveLocalEndpoint,
} from "@/lib/local/endpoint";
import { planArmOf, type Arm } from "@/lib/local/arm";
import { MIN_CONTEXT_TOKENS } from "@/lib/local/transport/probe";

const ENV_KEYS = [LOCAL_AGENT_URL_ENV, LOCAL_AGENT_TOKEN_ENV, LOCAL_AGENT_CONTEXT_ENV] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  __resetLocalContextWarning();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("which half of an arm is local", () => {
  const table: { half: { transport: "claude" | "pi"; model: string }; local: boolean; why: string }[] = [
    { half: { transport: "pi", model: "qwen3.8:27b" }, local: true, why: "pi has no hosted mode in this deployment" },
    { half: { transport: "pi", model: "sonnet" }, local: true, why: "still pi: the transport decides, not the name" },
    { half: { transport: "claude", model: "qwen3.8:27b" }, local: true, why: "not a Claude alias — the local endpoint" },
    { half: { transport: "claude", model: "sonnet" }, local: false, why: "the subscription seat" },
    { half: { transport: "claude", model: "opus" }, local: false, why: "the subscription seat" },
    { half: { transport: "claude", model: "haiku" }, local: false, why: "the subscription seat" },
  ];

  for (const { half, local, why } of table) {
    it(`${half.transport} + ${half.model} → ${local ? "an endpoint" : "null"} (${why})`, () => {
      expect(isLocalHalf(half)).toBe(local);
      const resolved = resolveLocalEndpoint(half);
      if (!local) {
        expect(resolved).toBeNull();
        return;
      }
      expect(resolved).toEqual({
        baseUrl: DEFAULT_LOCAL_AGENT_URL,
        model: half.model,
        token: DEFAULT_LOCAL_AGENT_TOKEN,
        contextTokens: DEFAULT_LOCAL_AGENT_CONTEXT,
      });
    });
  }

  it("takes the MODEL from the arm and never from the environment", () => {
    // A run records what it was armed with; an env-sourced model would make that record a claim
    // about the day it ran rather than about the arm.
    process.env[LOCAL_AGENT_URL_ENV] = "http://10.0.0.4:11434/";
    process.env[LOCAL_AGENT_TOKEN_ENV] = "anything";
    const ep = resolveLocalEndpoint({ transport: "pi", model: "llama3.3:70b" });
    // The trailing slash is stripped: `baseUrl` is the root with no path suffix.
    expect(ep).toEqual({ baseUrl: "http://10.0.0.4:11434", model: "llama3.3:70b", token: "anything", contextTokens: DEFAULT_LOCAL_AGENT_CONTEXT });
  });

  describe("the server root: one trailing /v<digits> segment is stripped", () => {
    it("strips an OpenAI-compatible /v1 suffix — the operator typed the model server path, not its root", () => {
      process.env[LOCAL_AGENT_URL_ENV] = "http://10.0.0.4:11434/v1";
      expect(resolveLocalEndpoint({ transport: "claude", model: "qwen3.8:27b" })?.baseUrl).toBe("http://10.0.0.4:11434");
    });

    it("strips a trailing slash after /v1 — neither the slash nor the suffix survives", () => {
      process.env[LOCAL_AGENT_URL_ENV] = "http://10.0.0.4:11434/v1/";
      expect(resolveLocalEndpoint({ transport: "claude", model: "qwen3.8:27b" })?.baseUrl).toBe("http://10.0.0.4:11434");
    });

    it("leaves a root with no suffix alone — DEFAULT_LOCAL_AGENT_URL", () => {
      delete process.env[LOCAL_AGENT_URL_ENV];
      expect(resolveLocalEndpoint({ transport: "pi", model: "m" })?.baseUrl).toBe(DEFAULT_LOCAL_AGENT_URL);
    });

    it("keeps a suffix that is NOT the last segment — /v1 is a path here, not a root", () => {
      process.env[LOCAL_AGENT_URL_ENV] = "http://10.0.0.4:11434/v1/preview";
      expect(resolveLocalEndpoint({ transport: "claude", model: "qwen3.8:27b" })?.baseUrl).toBe("http://10.0.0.4:11434/v1/preview");
    });
  });

  it("nothing to resolve is null, not a throw", () => {
    expect(resolveLocalEndpoint(null)).toBeNull();
    expect(resolveLocalEndpoint(undefined)).toBeNull();
  });
});

describe("a SPLIT arm resolves its two halves independently", () => {
  // The configuration the whole feature exists to measure: Claude plans on the seat, a local model
  // executes. One answer reused for both sessions makes it unreachable.
  const SPLIT: Arm = {
    id: "split",
    label: "claude plan -> local exec",
    transport: "pi",
    model: "qwen3.8:27b",
    plan: { transport: "claude", model: "sonnet" },
  };

  it("an endpoint for the execute half, none for the plan half", () => {
    expect(resolveLocalEndpoint(SPLIT)).toMatchObject({ model: "qwen3.8:27b" });
    expect(resolveLocalEndpoint(planArmOf(SPLIT))).toBeNull();
  });

  it("and the mirror image: Claude executes locally while pi plans", () => {
    const mirrored: Arm = { id: "m", label: "m", transport: "claude", model: "sonnet", plan: { transport: "pi", model: "qwen3.8:27b" } };
    expect(resolveLocalEndpoint(mirrored)).toBeNull();
    expect(resolveLocalEndpoint(planArmOf(mirrored))).toMatchObject({ model: "qwen3.8:27b" });
  });

  it("an UNSPLIT arm resolves the same endpoint for both halves", () => {
    const local: Arm = { id: "local", label: "local", transport: "pi", model: "qwen3.8:27b" };
    expect(resolveLocalEndpoint(local)).toEqual(resolveLocalEndpoint(planArmOf(local)));
  });
});

describe("the declared context window", () => {
  it("is taken as declared when it is at or above the floor", () => {
    process.env[LOCAL_AGENT_CONTEXT_ENV] = "131072";
    expect(resolveLocalEndpoint({ transport: "pi", model: "m" })?.contextTokens).toBe(131_072);
  });

  it("BELOW the floor is clamped up — a truncating window is never silently declared", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env[LOCAL_AGENT_CONTEXT_ENV] = "4096";
    const ep = resolveLocalEndpoint({ transport: "pi", model: "m" });
    expect(ep?.contextTokens).toBe(MIN_CONTEXT_TOKENS);
    expect(ep?.contextTokens).toBeGreaterThan(4096);
    // And it is LOUD, once: a deployment declaring a window that truncates the tool definitions has
    // made a mistake that otherwise presents as "the model cannot call tools".
    expect(warn).toHaveBeenCalledTimes(1);
    resolveLocalEndpoint({ transport: "pi", model: "m" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a non-number, a zero or a negative falls back to the default rather than to nonsense", () => {
    for (const raw of ["", "  ", "not-a-number", "0", "-1"]) {
      process.env[LOCAL_AGENT_CONTEXT_ENV] = raw;
      expect(resolveLocalEndpoint({ transport: "pi", model: "m" })?.contextTokens).toBe(DEFAULT_LOCAL_AGENT_CONTEXT);
    }
  });

  it("the default itself is at or above the floor", () => {
    expect(DEFAULT_LOCAL_AGENT_CONTEXT).toBeGreaterThanOrEqual(MIN_CONTEXT_TOKENS);
  });
});
