// The `local` provider — identity, configuration guard, selection, and the $0 cost class.
//
// The point of these tests is not that a local server can be reached (that is OpenAiProvider's
// protocol, already covered in openai.test.ts). It is that a local run is IDENTIFIED as local
// everywhere the system reasons about a scan afterwards: provenance, failover, and cost.

import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalProvider, localLlmConfigured } from "@/lib/llm/local";
import { getProvider, providerAvailable, providerByName, resolveProviderChoice } from "@/lib/llm";
import { isZeroCostProvider, providerLabel } from "@/lib/llm/config";
import { estimateLlmCostFromTable } from "@/lib/db/usage";

/** Put the env in a known state: no cloud keys, so `auto` cannot resolve to Gemini. */
function clearLlmEnv(): void {
  for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "LOCAL_LLM_BASE_URL", "LOCAL_LLM_MODEL", "LLM_PROVIDER"]) {
    vi.stubEnv(k, "");
  }
}

function configureLocal(): void {
  vi.stubEnv("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1");
  vi.stubEnv("LOCAL_LLM_MODEL", "qwen2.5-coder:14b");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("localLlmConfigured()", () => {
  // Half-configured is NOT configured: an endpoint with no model (or a model with no endpoint) cannot
  // complete a call, and reporting it available would put a doomed step in the failover chain.
  it("requires BOTH the base URL and the model", () => {
    clearLlmEnv();
    expect(localLlmConfigured()).toBe(false);

    vi.stubEnv("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1");
    expect(localLlmConfigured()).toBe(false);

    vi.stubEnv("LOCAL_LLM_MODEL", "qwen2.5-coder:14b");
    expect(localLlmConfigured()).toBe(true);
  });

  it("treats whitespace-only values as unset", () => {
    clearLlmEnv();
    vi.stubEnv("LOCAL_LLM_BASE_URL", "   ");
    vi.stubEnv("LOCAL_LLM_MODEL", "   ");
    expect(localLlmConfigured()).toBe(false);
  });
});

describe("LocalProvider identity", () => {
  it("reports its own provider name and the configured model", () => {
    clearLlmEnv();
    configureLocal();
    const p = new LocalProvider();
    expect(p.name).toBe("local");
    expect(p.model).toBe("qwen2.5-coder:14b");
  });

  // Regression guard for the reason this provider exists: routed through LLM_PROVIDER=openai it was
  // persisted as "openai", so /usage told a self-hoster their scores came from a vendor they never called.
  it("is never mistaken for openai", () => {
    clearLlmEnv();
    configureLocal();
    expect(new LocalProvider().name).not.toBe("openai");
  });

  it("has a human label for the /usage provenance bars", () => {
    expect(providerLabel("local")).toBe("Local model");
  });

  it("fails with the variable names when unconfigured, rather than calling api.openai.com", async () => {
    clearLlmEnv();
    const p = new LocalProvider();
    await expect(
      // The input is never read: assertConfigured() throws before any request is built.
      p.assess({ signals: [] } as unknown as Parameters<LocalProvider["assess"]>[0]),
    ).rejects.toThrow(/LOCAL_LLM_BASE_URL.*LOCAL_LLM_MODEL/s);
  });
});

describe("selection", () => {
  it("accepts local as an LLM_PROVIDER value", () => {
    vi.stubEnv("LLM_PROVIDER", "local");
    expect(resolveProviderChoice()).toBe("local");
  });

  it("builds a LocalProvider on an explicit selection", () => {
    clearLlmEnv();
    configureLocal();
    vi.stubEnv("LLM_PROVIDER", "local");
    expect(getProvider().name).toBe("local");
  });

  // The `auto` ladder's new rung. Without it, someone with Ollama running and both variables set
  // still got the deterministic mock floor from the default config — the app looks like it works
  // while every score is a rubric floor.
  it("auto prefers a configured local server over mock when no cloud key is present", () => {
    clearLlmEnv();
    configureLocal();
    expect(getProvider().name).toBe("local");
  });

  it("auto still falls back to mock when local is not configured", () => {
    clearLlmEnv();
    expect(getProvider().name).toBe("mock");
  });

  // Ordering matters: an existing deployment with a Gemini key must not silently change engine
  // because someone left LOCAL_LLM_* in the env.
  it("auto still prefers Gemini over local when a key is present", () => {
    clearLlmEnv();
    configureLocal();
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    expect(getProvider().name).toBe("gemini");
  });

  it("is available for failover only when fully configured", () => {
    clearLlmEnv();
    expect(providerAvailable("local")).toBe(false);
    expect(providerByName("local")).toBeNull();

    configureLocal();
    expect(providerAvailable("local")).toBe(true);
    expect(providerByName("local")?.name).toBe("local");
  });
});

describe("$0 cost class", () => {
  it("classifies local as zero-cost and hosted providers as not", () => {
    expect(isZeroCostProvider("local")).toBe(true);
    expect(isZeroCostProvider("openai")).toBe(false);
    // claude-cli runs under a PAID subscription and is deliberately priced at first-party rates.
    expect(isZeroCostProvider("claude-cli")).toBe(false);
    expect(isZeroCostProvider(null)).toBe(false);
  });

  // A self-hosted org whose only engine is local must read "$0.00", not "no estimate" — $0.00 is the
  // answer, and a null estimate renders as a broken panel.
  it("prices a local-only period at exactly zero", () => {
    expect(
      estimateLlmCostFromTable([
        { model: "qwen2.5-coder:14b", provider: "local", inputTokens: 900_000, outputTokens: 120_000 },
      ]),
    ).toBe(0);
  });

  // The bug this closes: MODEL_PRICES matches on model-id PREFIXES, so a local tag sharing a prefix
  // with a hosted model was invoiced at that vendor's rate for tokens that cost nothing.
  it("does not bill a local model that prefix-matches a hosted price row", () => {
    expect(
      estimateLlmCostFromTable([
        { model: "gpt-4o-mini-local-finetune", provider: "local", inputTokens: 1_000_000, outputTokens: 1_000_000 },
      ]),
    ).toBe(0);
  });

  it("still prices hosted tokens in a mixed period, adding nothing for the local ones", () => {
    const hostedOnly = estimateLlmCostFromTable([
      { model: "gpt-4o-mini", provider: "openai", inputTokens: 1_000_000, outputTokens: 1_000_000 },
    ]);
    const mixed = estimateLlmCostFromTable([
      { model: "gpt-4o-mini", provider: "openai", inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { model: "qwen2.5-coder:14b", provider: "local", inputTokens: 5_000_000, outputTokens: 5_000_000 },
    ]);
    expect(hostedOnly).toBeCloseTo(0.75, 6); // 0.15 in + 0.60 out per MTok
    expect(mixed).toBe(hostedOnly);
  });

  // Absent provider keeps the old behaviour exactly, so existing callers/mocks are unaffected.
  it("leaves provider-less rows on the model-table path", () => {
    expect(estimateLlmCostFromTable([{ model: "totally-unknown-model", inputTokens: 10, outputTokens: 10 }])).toBeNull();
  });
});
