// Regression tests for provider selection/availability (biz-bug-scan-2026-06-11, llm findings
// #1 and #4): the LLM path must either genuinely score or VISIBLY degrade — the picker and the
// failover must never hand the orchestrator a mock that masquerades as the intended provider.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProvider, providerAvailable, providerByName } from "./index";

// Every env var the bedrock/gemini availability checks read — stubbed empty so the host
// machine's real AWS/Gemini config can't leak into the assertions.
const ENV_VARS = [
  "LLM_PROVIDER",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "BEDROCK_REGION",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_PROFILE",
  "AWS_ROLE_ARN",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
] as const;

beforeEach(() => {
  for (const name of ENV_VARS) vi.stubEnv(name, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("providerAvailable('bedrock') — any AWS signal counts (#1)", () => {
  it("is false with no AWS-ish env at all", () => {
    expect(providerAvailable("bedrock")).toBe(false);
  });

  it("is true with BEDROCK_REGION only (the provider's own documented knob)", () => {
    vi.stubEnv("BEDROCK_REGION", "eu-central-1");
    expect(providerAvailable("bedrock")).toBe(true);
  });

  it("is true with credentials only (region defaults inside BedrockProvider)", () => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIAEXAMPLE");
    expect(providerAvailable("bedrock")).toBe(true);
  });

  it("is true with profile / role / container-credential signals", () => {
    vi.stubEnv("AWS_PROFILE", "ascent");
    expect(providerAvailable("bedrock")).toBe(true);
    vi.stubEnv("AWS_PROFILE", "");
    vi.stubEnv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "/v2/credentials/uuid");
    expect(providerAvailable("bedrock")).toBe(true);
  });

  it("still honors AWS_REGION / AWS_DEFAULT_REGION", () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    expect(providerAvailable("bedrock")).toBe(true);
  });
});

describe("getProvider with LLM_PROVIDER=bedrock — trust the explicit selection (#1)", () => {
  it("returns the real BedrockProvider even when no AWS env is visible (ambient role creds)", () => {
    vi.stubEnv("LLM_PROVIDER", "bedrock");
    const p = getProvider();
    // Pre-degrading here made intendedProvider 'mock' in scan.ts, suppressing the llmFailed
    // warning — the broken-config case must instead fail at assess() and degrade VISIBLY.
    expect(p.name).toBe("bedrock");
  });

  it("respects forceMock regardless of the choice", () => {
    vi.stubEnv("LLM_PROVIDER", "bedrock");
    expect(getProvider({ forceMock: true }).name).toBe("mock");
  });
});

describe("getProvider with LLM_PROVIDER=openai/claude-cli — trust the explicit selection (no silent mock)", () => {
  it("returns the real OpenAiProvider even with OPENAI_API_KEY unset (fails honestly at assess())", () => {
    vi.stubEnv("LLM_PROVIDER", "openai");
    // Was pre-degraded to mock here, suppressing the llmFailed warning (success theater). Must fail
    // VISIBLY at assess() and degrade through the accounted retry → failover → mock chain instead.
    expect(getProvider().name).toBe("openai");
  });

  it("returns the real ClaudeCliProvider even off a local box (e.g. Vercel) rather than silent mock", () => {
    vi.stubEnv("LLM_PROVIDER", "claude-cli");
    expect(getProvider().name).toBe("claude-cli");
  });
});

describe("providerByName('bedrock') — failover skip stays env-gated (#1)", () => {
  it("returns null with no AWS signal (skip the doomed failover attempt)", () => {
    expect(providerByName("bedrock")).toBeNull();
  });

  it("returns the real provider with BEDROCK_REGION configured", () => {
    vi.stubEnv("BEDROCK_REGION", "eu-central-1");
    expect(providerByName("bedrock")?.name).toBe("bedrock");
  });
});

describe("providerByName('gemini') — keyless must NOT masquerade as a real failover (#4)", () => {
  it("returns null without a key, so the scan's degradation accounting stays truthful", () => {
    // geminiOrMock()'s keyless branch is a MockProvider; returned from here it ran as a
    // "successful" failover in scan.ts and suppressed the llmFailed warning + fallback event.
    expect(providerByName("gemini")).toBeNull();
  });

  it("returns the real GeminiProvider when a key is present", () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    expect(providerByName("gemini")?.name).toBe("gemini");
  });

  it("honors the GOOGLE_API_KEY alias too", () => {
    vi.stubEnv("GOOGLE_API_KEY", "test-key");
    expect(providerByName("gemini")?.name).toBe("gemini");
  });

  it("still returns null for mock/unknown/empty per the contract", () => {
    expect(providerByName("mock")).toBeNull();
    expect(providerByName("nonsense")).toBeNull();
    expect(providerByName("")).toBeNull();
    expect(providerByName(undefined)).toBeNull();
  });
});
