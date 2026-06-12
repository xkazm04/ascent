// The built-in price table must price the shipped default models out-of-the-box (the /usage
// panel's default cost basis), match Bedrock ids regardless of geo routing prefix, prefer the
// longest (most specific) prefix, and refuse to price unknown models — an unknown model priced
// at a guessed rate would be a confidently-wrong bill.

import { describe, it, expect } from "vitest";
import { DEFAULT_BEDROCK_MODEL } from "./bedrock";
import { DEFAULT_GEMINI_MODEL } from "./gemini";
import { DEFAULT_OPENAI_MODEL } from "./openai";
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
