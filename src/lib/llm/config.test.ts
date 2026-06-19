// The built-in price table must price the shipped default models out-of-the-box (the /usage
// panel's default cost basis), match Bedrock ids regardless of geo routing prefix, prefer the
// longest (most specific) prefix, and refuse to price unknown models — an unknown model priced
// at a guessed rate would be a confidently-wrong bill.

import { describe, it, expect } from "vitest";
import { DEFAULT_BEDROCK_MODEL } from "./bedrock";
import { DEFAULT_GEMINI_MODEL } from "./gemini";
import { DEFAULT_OPENAI_MODEL } from "./openai";
import { DEFAULT_CLAUDE_MODEL } from "./claude-cli";
import { priceForModel } from "./config";

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
