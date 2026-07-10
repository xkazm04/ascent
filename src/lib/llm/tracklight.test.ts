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
} from "./tracklight";

const LT_ENV = ["LIGHTTRACK_URL", "LIGHTTRACK_PROJECT", "LIGHTTRACK_KEY", "LIGHTTRACK_ENABLED"] as const;

describe("toTracklightProvider", () => {
  it("maps ascent provider names onto tracklight's vocabulary", () => {
    expect(toTracklightProvider("gemini")).toBe("google");
    expect(toTracklightProvider("bedrock")).toBe("anthropic");
    expect(toTracklightProvider("claude-cli")).toBe("anthropic");
    expect(toTracklightProvider("openai")).toBe("openai");
    expect(toTracklightProvider("mock")).toBe("mock");
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
      usage: { input: 12000, output: 1500, cached_input: 8000 },
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

  it("omits project_id when none is configured, and zero-fills missing usage", () => {
    const body = buildEventBody({ provider: "mock", model: "mock" });
    expect(body).not.toHaveProperty("project_id");
    expect(body.usage).toEqual({ input: 0, output: 0 });
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
