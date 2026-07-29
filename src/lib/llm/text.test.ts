// The hosted text seam — "prompt in → model text out" against the SAME provider selection the scan
// pipeline uses. What matters here is RESOLUTION, not transport: no request is ever issued.
//
// The bug this file guards against is the one it was written to fix: the only text engine in the
// codebase was the local `claude` CLI, so every non-scan LLM surface (the memory write-gate, reflect)
// resolved to null in production and was structurally dead there.

import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveTextRunner } from "@/lib/llm/text";

const ENV_KEYS = [
  "LLM_PROVIDER",
  "NODE_ENV",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "BEDROCK_REGION",
] as const;

const setEnv = (patch: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) => {
  for (const k of ENV_KEYS) vi.stubEnv(k, patch[k] as string);
};

afterEach(() => vi.unstubAllEnvs());

describe("resolveTextRunner", () => {
  it("resolves a HOSTED runner in a production build — the whole point", async () => {
    setEnv({ NODE_ENV: "production", LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" });
    const runner = await resolveTextRunner();
    expect(runner?.engine).toBe("gemini");
    expect(typeof runner?.run).toBe("function");
  });

  it("honors each explicit hosted selection when its prerequisite is present", async () => {
    setEnv({ NODE_ENV: "production", LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" });
    expect((await resolveTextRunner())?.engine).toBe("openai");

    setEnv({ NODE_ENV: "production", LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" });
    expect((await resolveTextRunner())?.engine).toBe("openrouter");

    setEnv({ NODE_ENV: "production", LLM_PROVIDER: "bedrock", BEDROCK_REGION: "us-east-1" });
    expect((await resolveTextRunner())?.engine).toBe("bedrock");
  });

  it("returns null rather than SUBSTITUTING a provider the operator did not choose", async () => {
    // Explicitly selected, prerequisite absent: "no engine" is the honest answer, not a silent swap.
    setEnv({ NODE_ENV: "production", LLM_PROVIDER: "openai", GEMINI_API_KEY: "k" });
    expect(await resolveTextRunner()).toBeNull();
  });

  it("returns null for mock and for claude-cli on a production host", async () => {
    setEnv({ LLM_PROVIDER: "mock" });
    expect(await resolveTextRunner()).toBeNull();

    // Mirrors providerAvailable("claude-cli"): the prod build dead-code-prunes the CLI module away.
    setEnv({ NODE_ENV: "production", LLM_PROVIDER: "claude-cli" });
    expect(await resolveTextRunner()).toBeNull();
  });

  it("follows getProvider()'s `auto` rule: Gemini with a key, otherwise nothing", async () => {
    setEnv({ LLM_PROVIDER: undefined, GEMINI_API_KEY: "k" });
    expect((await resolveTextRunner())?.engine).toBe("gemini");

    setEnv({ LLM_PROVIDER: undefined });
    expect(await resolveTextRunner()).toBeNull();
  });
});
