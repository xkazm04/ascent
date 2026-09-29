// The LightTrack tracker is the fire-and-forget bridge from the scan pipeline to a local LLM-
// observability instance. It must: (1) be a hard no-op unless the operator opts in (no accidental
// traffic / behavior change), (2) map ascent's provider+model vocabulary onto tracklight's price-
// book form so cost rollups line up, (3) shape a well-formed /v1/events body, and (4) NEVER throw.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEventBody,
  toTracklightModel,
  toTracklightProvider,
  tracklightConfig,
  trackLlmCall,
  legKindUseCase,
} from "./tracklight";
import { billableInputTokens } from "./config";

const LT_ENV = ["LIGHTTRACK_URL", "LIGHTTRACK_PROJECT", "LIGHTTRACK_KEY", "LIGHTTRACK_ENABLED"] as const;

describe("toTracklightProvider", () => {
  it("maps ascent provider names onto tracklight's vocabulary", () => {
    expect(toTracklightProvider("gemini")).toBe("google");
    expect(toTracklightProvider("bedrock")).toBe("anthropic");
    expect(toTracklightProvider("claude-cli")).toBe("anthropic");
    expect(toTracklightProvider("openai")).toBe("openai");
    expect(toTracklightProvider("mock")).toBe("mock");
  });

  // OpenRouter is a proxy: the honest provider key is the slug's VENDOR, so an OpenRouter-routed
  // Sonnet is priced on the same row as a Bedrock Sonnet instead of landing outside the price book.
  it("resolves an openrouter call to the vendor its model slug routes to", () => {
    expect(toTracklightProvider("openrouter", "openai/gpt-4o-mini")).toBe("openai");
    expect(toTracklightProvider("openrouter", "anthropic/claude-sonnet-4-6")).toBe("anthropic");
    expect(toTracklightProvider("openrouter", "google/gemini-3-flash")).toBe("google");
    expect(toTracklightProvider("openrouter", "OpenAI/GPT-4o-mini")).toBe("openai");
  });

  it("keeps an unpriced openrouter vendor under `openrouter` rather than mis-attributing it", () => {
    expect(toTracklightProvider("openrouter", "meta-llama/llama-3.1-70b")).toBe("openrouter");
    expect(toTracklightProvider("openrouter")).toBe("openrouter");
  });
});

describe("toTracklightModel", () => {
  it("strips Bedrock geo + vendor prefixes to the bare price-book key", () => {
    expect(toTracklightModel("bedrock", "us.anthropic.claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(toTracklightModel("bedrock", "eu.anthropic.claude-haiku-4-5")).toBe("claude-haiku-4-5");
    expect(toTracklightModel("bedrock", "anthropic.claude-opus-4-8")).toBe("claude-opus-4-8");
  });

  it("expands claude-cli short aliases to canonical ids", () => {
    expect(toTracklightModel("claude-cli", "sonnet")).toBe("claude-sonnet-4-6");
    expect(toTracklightModel("claude-cli", "haiku")).toBe("claude-haiku-4-5");
    expect(toTracklightModel("claude-cli", "opus")).toBe("claude-opus-4-8");
    // Unknown alias passes through unchanged.
    expect(toTracklightModel("claude-cli", "sonnet-next")).toBe("sonnet-next");
  });

  it("passes gemini/openai model ids through unchanged", () => {
    expect(toTracklightModel("gemini", "gemini-3-flash-preview")).toBe("gemini-3-flash-preview");
    expect(toTracklightModel("openai", "gpt-4o-mini")).toBe("gpt-4o-mini");
  });

  it("strips the openrouter vendor prefix exactly when the provider key was that vendor", () => {
    expect(toTracklightModel("openrouter", "openai/gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(toTracklightModel("openrouter", "anthropic/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    // Unpriced vendor: provider stays "openrouter", so the model must keep the FULL slug — the two
    // halves of the "<provider>/<model>" cost key are decided together.
    expect(toTracklightProvider("openrouter", "meta-llama/llama-3.1-70b")).toBe("openrouter");
    expect(toTracklightModel("openrouter", "meta-llama/llama-3.1-70b")).toBe("meta-llama/llama-3.1-70b");
  });
});

describe("buildEventBody", () => {
  it("shapes a full event with usage, latency, tags, and metadata", () => {
    const body = buildEventBody(
      {
        provider: "bedrock",
        model: "us.anthropic.claude-sonnet-4-6",
        usage: { inputTokens: 12000, outputTokens: 1500, cacheReadTokens: 8000 },
        latencyMs: 4200.7,
        status: "success",
        repo: "vercel/next.js",
        org: "public",
      },
      "proj-123",
    );
    expect(body).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      usage: { input: 20000, output: 1500, cached_input: 8000 }, // whole prompt: 12000 fresh + 8000 cached
      source: "ascent",
      operation: "chat",
      project_id: "proj-123",
      latency_ms: 4200, // truncated
      status: "success",
      metadata: { repo: "vercel/next.js", org: "public" },
    });
    expect(body.tags).toEqual(["scan"]);
  });

  it("defaults status to error when an error message is present, and truncates it", () => {
    const long = "x".repeat(1000);
    const body = buildEventBody({ provider: "gemini", model: "gemini-3-flash-preview", error: long });
    expect(body.status).toBe("error");
    expect((body.error as string).length).toBe(500);
  });

  it("adds a degraded tag + metadata flag when the scan fell back to the floor", () => {
    const body = buildEventBody({ provider: "openai", model: "gpt-4o-mini", degraded: true });
    expect(body.tags).toEqual(["scan", "degraded"]);
    expect(body.metadata).toMatchObject({ degraded: true });
  });

  it("prices an openrouter call under the vendor its slug routes to", () => {
    const body = buildEventBody({ provider: "openrouter", model: "anthropic/claude-sonnet-4-6" });
    expect(body).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  // Was: "zero-fills missing usage". It no longer does, deliberately — `input: 0, output: 0` is
  // indistinguishable from a genuinely free call, so an unreadable usage block used to be mirrored as
  // a confident "this cost nothing". Absent now means unknown.
  it("omits project_id when none is configured, and OMITS usage it could not read", () => {
    const body = buildEventBody({ provider: "mock", model: "mock" });
    expect(body).not.toHaveProperty("project_id");
    expect(body).not.toHaveProperty("usage");
  });

  it("keeps a partially-reported usage block, without inventing the missing half", () => {
    const body = buildEventBody({ provider: "gemini", model: "gemini-3-flash", usage: { inputTokens: 12 } });
    expect(body.usage).toEqual({ input: 12 });
  });

  it("records a genuine zero as zero — free is a fact, unknown is not", () => {
    const body = buildEventBody({ provider: "local", model: "qwen", usage: { inputTokens: 0, outputTokens: 0 } });
    expect(body.usage).toEqual({ input: 0, output: 0 });
  });

  it("carries the use-case name when a caller supplies one", () => {
    const body = buildEventBody({ provider: "bedrock", model: "us.anthropic.claude-sonnet-4-6", name: "athena.turn" });
    expect(body.name).toBe("athena.turn");
  });

  it("omits name rather than sending a placeholder when none is supplied", () => {
    const body = buildEventBody({ provider: "mock", model: "mock" });
    expect(body).not.toHaveProperty("name");
  });
});

// tracklight's price book defines `input` as the WHOLE prompt with `cached_input` a SUBSET of it
// (crates/core/src/event.rs, TokenUsage): it bills `input - cached_input` at the input rate and
// `cached_input` at the cached rate. Bedrock and claude-cli report `inputTokens` as the FRESH input
// only, with the cache classes beside it, so the mirror must add them back before sending.
describe("buildEventBody cache accounting", () => {
  // claude-sonnet-4-6 in tracklight's config/pricing.json ($ per MTok); the cached rate is 10% of
  // input, the same ratio ascent's own meter uses (CACHE_READ_RATE).
  const RATE = { input: 3, cached: 0.3, output: 15 };
  const CALL = { inputTokens: 24, cacheReadTokens: 2048, cacheWriteTokens: 1500, outputTokens: 310 };

  /** The tracklight price rule, applied to the emitted body's usage block only. */
  function mirroredCostUsd(body: Record<string, unknown>): number {
    const u = (body.usage ?? {}) as { input?: number; cached_input?: number; output?: number };
    const input = u.input ?? 0;
    const cached = u.cached_input ?? 0;
    const output = u.output ?? 0;
    return (Math.max(0, input - cached) * RATE.input + cached * RATE.cached + output * RATE.output) / 1_000_000;
  }
  /** Ascent's own meter cost basis for the same call (meter.ts costMicrosFor's formula, unrounded). */
  function meterCostUsd(usage: typeof CALL): number {
    return (billableInputTokens(usage) * RATE.input + usage.outputTokens * RATE.output) / 1_000_000;
  }

  it.each(["bedrock", "claude-cli"] as const)(
    "%s: emits the whole prompt as input, with the cache-read subset as cached_input",
    (provider) => {
      const body = buildEventBody({ provider, model: "claude-sonnet-4-6", usage: CALL });
      expect(body.usage).toEqual({ input: 24 + 2048 + 1500, output: 310, cached_input: 2048 });
    },
  );

  it("prices a cache hit at ascent's own meter cost, less the cache-write premium tracklight has no rate for", () => {
    const body = buildEventBody({ provider: "bedrock", model: "us.anthropic.claude-sonnet-4-6", usage: CALL });
    // tracklight bills a cache write at the plain input rate; ascent bills it at 1.25x. That residual
    // is the price book's missing write rate, not a token-accounting error.
    const writePremium = (CALL.cacheWriteTokens * (1.25 - 1) * RATE.input) / 1_000_000;
    expect(mirroredCostUsd(body) + writePremium).toBeCloseTo(meterCostUsd(CALL), 5); // billableInputTokens rounds to a whole token
    expect(mirroredCostUsd(body)).toBeLessThan(meterCostUsd(CALL));
    // Before the fix the fresh 24 tokens were subtracted away (saturating at 0) and the writes never
    // billed: the mirror priced this call at about half of what the meter charged.
    expect(mirroredCostUsd(body)).toBeGreaterThan(meterCostUsd(CALL) * 0.85);
  });

  it("leaves a no-cache call byte-identical", () => {
    for (const provider of ["bedrock", "claude-cli"] as const) {
      const body = buildEventBody({
        provider,
        model: "claude-sonnet-4-6",
        usage: { inputTokens: 1200, outputTokens: 340 },
      });
      expect(JSON.stringify(body.usage)).toBe('{"input":1200,"output":340}');
    }
  });

  it("does not add cache classes to a provider whose inputTokens is already the whole prompt", () => {
    // OpenAI-style prompt_tokens includes cached tokens. No adapter reports cache fields today, but a
    // future one that does must not be double counted by the fold.
    for (const provider of ["openai", "openrouter", "gemini", "local"] as const) {
      const body = buildEventBody({
        provider,
        model: "gpt-4o-mini",
        usage: { inputTokens: 2000, outputTokens: 100, cacheReadTokens: 1500 },
      });
      expect(JSON.stringify(body.usage)).toBe('{"input":2000,"output":100,"cached_input":1500}');
    }
  });

  it("does not invent a whole-prompt input when the provider reported no fresh input", () => {
    const body = buildEventBody({ provider: "bedrock", model: "claude-sonnet-4-6", usage: { cacheReadTokens: 800 } });
    expect(body.usage).toEqual({ cached_input: 800 });
  });
});

describe("legKindUseCase", () => {
  it("maps each leg kind with a declared use case", () => {
    expect(legKindUseCase("athena_turn")).toBe("athena.turn");
    expect(legKindUseCase("athena_cycle")).toBe("athena.cycle");
    expect(legKindUseCase("briefing")).toBe("org.briefing_narrative");
    expect(legKindUseCase("lane_summary")).toBe("local.lane_summary");
  });

  // consolidation-engine.ts's resolveMemoryRunner is ONE runner shared by the write-gate judgment and
  // the reflection rollup — both run under legKind "memory" with no signal to tell them apart here.
  it("attributes the shared memory legKind to memory.write_gate, not a third invented name", () => {
    expect(legKindUseCase("memory")).toBe("memory.write_gate");
  });

  it("leaves scan unmapped — scan-assess.ts tracks scan.calibrate directly, not through a legKind", () => {
    expect(legKindUseCase("scan")).toBeUndefined();
  });
});

describe("tracklightConfig (env-gated)", () => {
  beforeEach(() => {
    for (const k of LT_ENV) vi.stubEnv(k, "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is disabled by default (no project/key/flag) — zero behavior change", () => {
    expect(tracklightConfig().enabled).toBe(false);
  });

  it("auto-enables once a project id is configured", () => {
    vi.stubEnv("LIGHTTRACK_PROJECT", "proj-123");
    expect(tracklightConfig().enabled).toBe(true);
  });

  it("auto-enables once a key is configured", () => {
    vi.stubEnv("LIGHTTRACK_KEY", "lt_abc_def");
    expect(tracklightConfig().enabled).toBe(true);
  });

  it("LIGHTTRACK_ENABLED=0 forces off even with a project set", () => {
    vi.stubEnv("LIGHTTRACK_PROJECT", "proj-123");
    vi.stubEnv("LIGHTTRACK_ENABLED", "0");
    expect(tracklightConfig().enabled).toBe(false);
  });

  it("LIGHTTRACK_ENABLED=1 forces on with no project/key", () => {
    vi.stubEnv("LIGHTTRACK_ENABLED", "1");
    expect(tracklightConfig().enabled).toBe(true);
  });

  it("defaults the URL to localhost and trims a trailing slash", () => {
    vi.stubEnv("LIGHTTRACK_URL", "http://example.test:9000/");
    expect(tracklightConfig().url).toBe("http://example.test:9000");
    vi.stubEnv("LIGHTTRACK_URL", "");
    expect(tracklightConfig().url).toBe("http://127.0.0.1:8787");
  });
});

describe("trackLlmCall", () => {
  beforeEach(() => {
    for (const k of LT_ENV) vi.stubEnv(k, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does NOT touch the network when disabled", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    trackLlmCall({ provider: "gemini", model: "gemini-3-flash-preview", usage: { inputTokens: 1 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs a /v1/events body to the configured URL when enabled", () => {
    vi.stubEnv("LIGHTTRACK_PROJECT", "proj-123");
    vi.stubEnv("LIGHTTRACK_URL", "http://lt.test:8787");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    trackLlmCall({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      usage: { inputTokens: 10, outputTokens: 2 },
      latencyMs: 100,
      status: "success",
      repo: "a/b",
      org: "public",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://lt.test:8787/v1/events");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({
      provider: "google",
      model: "gemini-3-flash-preview",
      project_id: "proj-123",
      usage: { input: 10, output: 2 },
      source: "ascent",
    });
  });

  it("never throws even if fetch is broken", () => {
    vi.stubEnv("LIGHTTRACK_ENABLED", "1");
    vi.stubGlobal("fetch", () => {
      throw new Error("network down");
    });
    expect(() =>
      trackLlmCall({ provider: "openai", model: "gpt-4o-mini", usage: { inputTokens: 1 } }),
    ).not.toThrow();
  });
});
