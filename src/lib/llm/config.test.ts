// The built-in price table must price the shipped default models out-of-the-box (the /usage
// panel's default cost basis), match Bedrock ids regardless of geo routing prefix, prefer the
// longest (most specific) prefix, and refuse to price unknown models — an unknown model priced
// at a guessed rate would be a confidently-wrong bill.

import { describe, it, expect } from "vitest";
import { DEFAULT_BEDROCK_MODEL } from "./bedrock";
import { DEFAULT_GEMINI_MODEL } from "./gemini";
import { DEFAULT_OPENAI_MODEL } from "./openai";
import { DEFAULT_CLAUDE_MODEL } from "./claude-cli";
import { DEFAULT_OPENROUTER_MODEL } from "./openrouter";
import {
  priceForModel,
  billableInputTokens,
  thinkingBudgetTokens,
  withLlmTimeout,
  llmTimeoutMs,
  llmTemperature,
  llmMaxTokens,
  providerLabel,
} from "./config";
import type { ProviderName } from "@/lib/types";
import { afterEach, beforeEach, vi } from "vitest";

describe("priceForModel", () => {
  // OpenRouter ids are "vendor/model" slugs, which matched no family prefix — so EVERY OpenRouter model
  // priced as null, and one unpriced model nulls the whole org's /usage cost estimate for the period.
  // The loop below omitted DEFAULT_OPENROUTER_MODEL, which is exactly how that shipped.
  it("prices a vendor/model OpenRouter slug by stripping the vendor segment", () => {
    expect(priceForModel(DEFAULT_OPENROUTER_MODEL)).not.toBeNull();
    expect(priceForModel("openai/gpt-4o-mini")).toEqual(priceForModel("gpt-4o-mini"));
    expect(priceForModel("google/gemini-3-flash")).toEqual(priceForModel("gemini-3-flash"));
    // Anthropic-via-OpenRouter: neither the Bedrock dotted id nor the bare CLI alias matches it.
    const sonnet = priceForModel("anthropic/claude-sonnet-4");
    expect(sonnet).not.toBeNull();
    expect(sonnet!.inPerMTok).toBe(3);
    expect(sonnet!.outPerMTok).toBe(15);
  });

  it("still refuses to price an unknown vendor/model slug", () => {
    expect(priceForModel("somevendor/never-heard-of-it")).toBeNull();
  });

  it("prices every shipped default model (derived from the providers' own constants)", () => {
    for (const model of [DEFAULT_BEDROCK_MODEL, DEFAULT_GEMINI_MODEL, DEFAULT_OPENAI_MODEL, DEFAULT_OPENROUTER_MODEL]) {
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
    expect(priceForModel("sonnet")).toEqual({
      prefix: "sonnet",
      inPerMTok: 3,
      outPerMTok: 15,
      exact: true,
    });
    expect(priceForModel("haiku")).toEqual({
      prefix: "haiku",
      inPerMTok: 1,
      outPerMTok: 5,
      exact: true,
    });
    expect(priceForModel("opus")).toEqual({
      prefix: "opus",
      inPerMTok: 5,
      outPerMTok: 25,
      exact: true,
    });
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

  // G3-17: the bare claude-cli aliases ("sonnet"/"haiku"/"opus") used a plain prefix match, so a
  // self-hosted/OpenAI-compatible model id sharing the word (e.g. "opus-7b") was billed at first-party
  // Claude Opus rates instead of returning "no estimate" for an unpriced model.
  it("does not overbill a self-hosted/compatible model id that merely shares a bare-alias prefix", () => {
    expect(priceForModel("opus-7b")).toBeNull();
    expect(priceForModel("sonnet-3-5-instruct")).toBeNull();
    expect(priceForModel("haiku-mini")).toBeNull();
    // The exact bare aliases still price (unchanged behavior).
    expect(priceForModel("sonnet")).not.toBeNull();
    expect(priceForModel("haiku")).not.toBeNull();
    expect(priceForModel("opus")).not.toBeNull();
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

describe("llmTimeoutMs (per-call timeout, floored so a misconfig can't instant-abort every scan)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to 60s when unset/blank", () => {
    vi.stubEnv("LLM_TIMEOUT_MS", "");
    expect(llmTimeoutMs()).toBe(60_000);
  });

  it("honors a configured value above the floor", () => {
    vi.stubEnv("LLM_TIMEOUT_MS", "30000");
    expect(llmTimeoutMs()).toBe(30_000);
  });

  it("floors LLM_TIMEOUT_MS=0 to 1s instead of 0 (0ms would abort every call on the next tick → mock)", () => {
    // The whole point of the fix: a well-meant `=0` ('no timeout') must NOT resolve to a 0ms
    // AbortController that instant-aborts every gemini/bedrock/openai call to the deterministic floor.
    vi.stubEnv("LLM_TIMEOUT_MS", "0");
    expect(llmTimeoutMs()).toBe(1_000);
  });

  it("floors negative and sub-second values to 1s (both are misconfigurations)", () => {
    vi.stubEnv("LLM_TIMEOUT_MS", "-5000");
    expect(llmTimeoutMs()).toBe(1_000);
    vi.stubEnv("LLM_TIMEOUT_MS", "250");
    expect(llmTimeoutMs()).toBe(1_000);
  });
});

describe("providerLabel (provenance vocabulary — /usage bars + briefing 'Scored by' line)", () => {
  it("has a polished (non-raw-id) label for EVERY ProviderName member", () => {
    // openai/openrouter were missing, so their raw lowercase ids rendered next to "AWS Bedrock" on
    // the two provenance surfaces executives read. (llm-provider-abstraction #4)
    const all: ProviderName[] = ["gemini", "bedrock", "openai", "openrouter", "mock", "claude-cli"];
    for (const id of all) {
      const label = providerLabel(id);
      expect(label, `PROVIDER_LABEL is missing "${id}"`).not.toBe(id);
      expect(label.length).toBeGreaterThan(0);
    }
    expect(providerLabel("openai")).toBe("OpenAI");
    expect(providerLabel("openrouter")).toBe("OpenRouter");
  });

  it("still falls back to the raw id for an unknown legacy id", () => {
    expect(providerLabel("some-future-provider")).toBe("some-future-provider");
  });
});

describe("llmTemperature (clamped to [0,2] — same misconfig hardening as the timeout floor)", () => {
  afterEach(() => vi.unstubAllEnvs());

  // The default is 0, not 0.2 (changed 2026-07-28, VALUE-CASE D29): every score ascent shows is an
  // anchored number a customer files, so reproducibility beats sampling nuance. Pinned here because a
  // silent drift back to a sampling default would make filed artifacts disagree with a re-scan.
  it("defaults to 0 when unset/blank/garbage", () => {
    vi.stubEnv("LLM_TEMPERATURE", "");
    expect(llmTemperature()).toBe(0);
    vi.stubEnv("LLM_TEMPERATURE", "warm");
    expect(llmTemperature()).toBe(0);
  });

  it("honors an in-range configured value, including a deliberate non-zero", () => {
    vi.stubEnv("LLM_TEMPERATURE", "0");
    expect(llmTemperature()).toBe(0);
    vi.stubEnv("LLM_TEMPERATURE", "0.2");
    expect(llmTemperature()).toBe(0.2);
    vi.stubEnv("LLM_TEMPERATURE", "1.5");
    expect(llmTemperature()).toBe(1.5);
  });

  it("clamps out-of-range values instead of letting them 400 every real-provider call", () => {
    // LLM_TEMPERATURE=5 previously flowed into the request body, Gemini/OpenAI reject >2 with a 400,
    // and 100% of scans silently degraded to the deterministic mock floor.
    vi.stubEnv("LLM_TEMPERATURE", "5");
    expect(llmTemperature()).toBe(2);
    vi.stubEnv("LLM_TEMPERATURE", "-1");
    expect(llmTemperature()).toBe(0);
  });
});

describe("llmMaxTokens (per-provider completion cap, floored so 0/negative can't fail every call)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to 4096 when unset/blank/garbage", () => {
    vi.stubEnv("OPENAI_MAX_TOKENS", "");
    expect(llmMaxTokens("OPENAI_MAX_TOKENS")).toBe(4096);
    vi.stubEnv("OPENAI_MAX_TOKENS", "plenty");
    expect(llmMaxTokens("OPENAI_MAX_TOKENS")).toBe(4096);
  });

  it("honors a configured value above the floor (rounded to an integer)", () => {
    vi.stubEnv("BEDROCK_MAX_TOKENS", "8192");
    expect(llmMaxTokens("BEDROCK_MAX_TOKENS")).toBe(8192);
    vi.stubEnv("BEDROCK_MAX_TOKENS", "1000.7");
    expect(llmMaxTokens("BEDROCK_MAX_TOKENS")).toBe(1001);
  });

  it("floors 0/negative/tiny values to 256 instead of failing every real-provider call", () => {
    // BEDROCK_MAX_TOKENS=0 / OPENAI_MAX_TOKENS=-1 previously flowed straight into the request and made
    // every call fail — the identical silent all-scans-to-mock symptom the timeout floor was built to kill.
    for (const v of ["0", "-1", "16"]) {
      vi.stubEnv("OPENROUTER_MAX_TOKENS", v);
      expect(llmMaxTokens("OPENROUTER_MAX_TOKENS")).toBe(256);
    }
  });
});

describe("withLlmTimeout (shared provider cancellation wiring)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("aborts with the given message after `ms` and clears nothing the caller still needs", async () => {
    const { signal, clear } = withLlmTimeout(undefined, 1000, "Provider request timed out.");
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).message).toBe("Provider request timed out.");
    clear(); // safe to call after the fact
  });

  it("combines the caller's signal: a client disconnect aborts the combined signal too", () => {
    const caller = new AbortController();
    const { signal } = withLlmTimeout(caller.signal, 60_000, "timed out");
    expect(signal.aborted).toBe(false);
    caller.abort(new Error("client disconnected"));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).message).toBe("client disconnected");
  });

  it("clear() cancels the timer so the timeout never fires after a fast success", async () => {
    const { signal, clear } = withLlmTimeout(undefined, 1000, "timed out");
    clear();
    expect(vi.getTimerCount()).toBe(0); // timer cleared — no leak
    await vi.advanceTimersByTimeAsync(5000);
    expect(signal.aborted).toBe(false); // never aborted, the call already finished
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Gemini 3.7 Flash pricing is PROMOTIONAL and dated. Google's introductory rate (0.75 / 3.75) runs
// through 2026-12-31 and DOUBLES to 1.5 / 7.5 on 2027-01-01.
//
// The table has no date dimension — adding one for a single temporary promo would put a clock inside
// a pure lookup. So the reversion is enforced HERE: this test fails the moment the promo ends,
// turning a comment nobody re-reads into a build failure someone must act on. When it fires, update
// the MODEL_PRICES row to 1.5 / 7.5 and update the expectations below.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("gemini-3.7-flash promotional pricing", () => {
  const PROMO_ENDS = Date.parse("2027-01-01T00:00:00Z");

  it("carries the introductory rate the org is actually billed today", () => {
    const p = priceForModel("gemini-3.7-flash");
    expect(p).toMatchObject({ inPerMTok: 0.75, outPerMTok: 3.75 });
  });

  it("FAILS ON 2027-01-01 so the reversion to 1.5 / 7.5 cannot be forgotten", () => {
    if (Date.now() >= PROMO_ENDS) {
      throw new Error(
        "Gemini 3.7 Flash's introductory pricing ended on 2027-01-01. Update the MODEL_PRICES row to " +
          "inPerMTok: 1.5, outPerMTok: 7.5 and update this test's expectations.",
      );
    }
    expect(Date.now()).toBeLessThan(PROMO_ENDS);
  });

  // The dash/dot split is a real trap: "gemini-3.7-flash" shares no prefix with "gemini-3-flash",
  // and an unpriced model nulls the whole org's /usage cost estimate for the period.
  it("does not accidentally match the retired preview row", () => {
    expect(priceForModel("gemini-3.7-flash")?.prefix).toBe("gemini-3.7-flash");
    expect(priceForModel("gemini-3-flash-preview")?.prefix).toBe("gemini-3-flash");
  });
});

describe("full claude-cli model ids price correctly", () => {
  // The bare-alias rows are `exact`, so a full id ("claude-opus-5") matches none of them. Without a
  // dedicated row it would price as "no estimate" and null the org's cost panel.
  it("prices a full Opus 5 id at the Opus tier", () => {
    expect(priceForModel("claude-opus-5")).toMatchObject({ inPerMTok: 5, outPerMTok: 25 });
  });

  it("still prices the bare aliases", () => {
    expect(priceForModel("opus")).toMatchObject({ inPerMTok: 5, outPerMTok: 25 });
    expect(priceForModel("sonnet")).toMatchObject({ inPerMTok: 3, outPerMTok: 15 });
  });

  // The guard the exact-match rule exists for: an unrelated model that merely starts with "opus"
  // must not be billed at first-party Claude rates.
  it("does not bill an unrelated 'opus…' model at Claude rates", () => {
    expect(priceForModel("opus-7b")).toBeNull();
  });
});
