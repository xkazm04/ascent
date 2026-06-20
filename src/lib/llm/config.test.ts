// The built-in price table must price the shipped default models out-of-the-box (the /usage
// panel's default cost basis), match Bedrock ids regardless of geo routing prefix, prefer the
// longest (most specific) prefix, and refuse to price unknown models — an unknown model priced
// at a guessed rate would be a confidently-wrong bill.

import { describe, it, expect } from "vitest";
import { DEFAULT_BEDROCK_MODEL } from "./bedrock";
import { DEFAULT_GEMINI_MODEL } from "./gemini";
import { DEFAULT_OPENAI_MODEL } from "./openai";
import { DEFAULT_CLAUDE_MODEL } from "./claude-cli";
import { priceForModel, billableInputTokens, thinkingBudgetTokens } from "./config";
import { afterEach, vi } from "vitest";

describe("priceForModel", () => {
  it("prices every shipped default model (derived from the providers' own constants)", () => {
    for (const model of [DEFAULT_BEDROCK_MODEL, DEFAULT_GEMINI_MODEL, DEFAULT_OPENAI_MODEL]) {
      const price = priceForModel(model);
      expect(price, `no built-in rate for default model "${model}"`).not.toBeNull();
      expect(price!.inPerMTok).toBeGreaterThan(0);
      expect(price!.outPerMTok).toBeGreaterThan(0);
    }
  });

  it("strips Bedrock geo routing prefixes before matching", () => {
    const bare = priceForModel("anthropic.claude-sonnet-4-6");
    expect(bare).not.toBeNull();
    for (const geo of ["us.", "eu.", "apac.", "global."]) {
      expect(priceForModel(`${geo}anthropic.claude-sonnet-4-6`)).toEqual(bare);
    }
  });

  it("prefers the longest matching prefix (gpt-4o-mini is not priced as gpt-4o)", () => {
    const mini = priceForModel("gpt-4o-mini");
    const full = priceForModel("gpt-4o");
    expect(mini).not.toBeNull();
    expect(full).not.toBeNull();
    expect(mini!.inPerMTok).toBeLessThan(full!.inPerMTok);
  });

  it("prices the bare claude-cli model aliases (sonnet/haiku/opus) at first-party rates", () => {
    // A claude-cli scan persists engineModel: "sonnet"/"haiku"/"opus" (CLAUDE_MODEL); each bare
    // alias must price, not return null ("no estimate") on a first-class local/eval provider.
    expect(priceForModel("sonnet")).toEqual({ prefix: "sonnet", inPerMTok: 3, outPerMTok: 15 });
    expect(priceForModel("haiku")).toEqual({ prefix: "haiku", inPerMTok: 1, outPerMTok: 5 });
    expect(priceForModel("opus")).toEqual({ prefix: "opus", inPerMTok: 5, outPerMTok: 25 });
  });

  it("prices the claude-cli default model (derived from claude-cli's own constant)", () => {
    const price = priceForModel(DEFAULT_CLAUDE_MODEL);
    expect(price, `no built-in rate for DEFAULT_CLAUDE_MODEL "${DEFAULT_CLAUDE_MODEL}"`).not.toBeNull();
    expect(price!.inPerMTok).toBeGreaterThan(0);
    expect(price!.outPerMTok).toBeGreaterThan(0);
  });

  it("longest-prefix tie-break: a specific Bedrock id beats the shorter bare alias row", () => {
    // "anthropic.claude-sonnet-4-6" must match the long "anthropic.claude-sonnet-4" row, never a
    // shorter accidental match — a future reorder/edit of MODEL_PRICES must not let a short prefix
    // mistier the bill. Assert the matched prefix is the long, most-specific one.
    const sonnet46 = priceForModel("anthropic.claude-sonnet-4-6");
    expect(sonnet46).not.toBeNull();
    expect(sonnet46!.prefix).toBe("anthropic.claude-sonnet-4");
    expect(sonnet46).toEqual({ prefix: "anthropic.claude-sonnet-4", inPerMTok: 3, outPerMTok: 15 });

    // The geo-stripped Bedrock id likewise resolves to the long row, not the bare "sonnet" alias.
    expect(priceForModel("us.anthropic.claude-sonnet-4-6")!.prefix).toBe(
      "anthropic.claude-sonnet-4",
    );
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    expect(priceForModel(" US.Anthropic.Claude-Sonnet-4-6 ")).toEqual(
      priceForModel("anthropic.claude-sonnet-4-6"),
    );
  });

  it("returns null for unknown models, mock, and empty input", () => {
    expect(priceForModel("totally-local-llama")).toBeNull();
    expect(priceForModel("mock")).toBeNull();
    expect(priceForModel("")).toBeNull();
    expect(priceForModel(null)).toBeNull();
    expect(priceForModel(undefined)).toBeNull();
  });
});

describe("billableInputTokens (cache-aware cost basis — Tiger P1-6)", () => {
  it("returns inputTokens unchanged when no cache fields are present (the non-cached case)", () => {
    expect(billableInputTokens({ inputTokens: 3200 })).toBe(3200);
    expect(billableInputTokens({})).toBe(0);
  });

  it("folds cache reads at ~10% and cache writes at ~125% of the input rate", () => {
    // 1200 fresh + 2000 cached-read (×0.10 = 200) + 800 cached-write (×1.25 = 1000) = 2400 cost-equiv.
    expect(billableInputTokens({ inputTokens: 1200, cacheReadTokens: 2000, cacheWriteTokens: 800 })).toBe(2400);
  });

  it("a re-scan reading a big cached prefix costs far less than billing it as fresh input", () => {
    const fresh = billableInputTokens({ inputTokens: 3200 }); // first scan, prefix billed full
    const cached = billableInputTokens({ inputTokens: 1200, cacheReadTokens: 2000 }); // re-scan: prefix cached
    expect(cached).toBeLessThan(fresh);
    expect(cached).toBe(1400); // 1200 + 2000×0.10
  });

  it("tolerates null/undefined token fields", () => {
    expect(billableInputTokens({ inputTokens: null, cacheReadTokens: null, cacheWriteTokens: null })).toBe(0);
  });
});

describe("thinkingBudgetTokens (opt-in extended thinking — Tiger P2-6c)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is 0 (off) when LLM_THINKING_BUDGET is unset — the default, no behavior change", () => {
    vi.stubEnv("LLM_THINKING_BUDGET", "");
    expect(thinkingBudgetTokens()).toBe(0);
  });

  it("returns the configured budget when set to a positive integer", () => {
    vi.stubEnv("LLM_THINKING_BUDGET", "2048");
    expect(thinkingBudgetTokens()).toBe(2048);
  });

  it("treats zero, negative, and non-numeric as OFF (0)", () => {
    for (const v of ["0", "-500", "lots"]) {
      vi.stubEnv("LLM_THINKING_BUDGET", v);
      expect(thinkingBudgetTokens()).toBe(0);
    }
  });
});
