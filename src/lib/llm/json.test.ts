import { describe, it, expect } from "vitest";
import { parseJsonLoose, ProviderParseError } from "./json";

describe("parseJsonLoose", () => {
  it("parses clean JSON", () => {
    expect(parseJsonLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    const text = "Here you go:\n```json\n{ \"score\": 80 }\n```\nthanks!";
    expect(parseJsonLoose<{ score: number }>(text)).toEqual({ score: 80 });
  });

  it("parses a fenced block without a language tag", () => {
    expect(parseJsonLoose<{ ok: boolean }>("```\n{\"ok\":true}\n```")).toEqual({ ok: true });
  });

  it("ignores leading prose that contains braces", () => {
    // The first "{" is inside prose, not valid JSON — extraction must skip to the real object.
    const text = 'Note: scores like {score} are 0-100. Result: {"score": 42, "ok": true}';
    expect(parseJsonLoose<{ score: number; ok: boolean }>(text)).toEqual({ score: 42, ok: true });
  });

  it("parses a top-level array", () => {
    expect(parseJsonLoose<number[]>("output: [1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("takes the first of two JSON blocks and ignores trailing junk", () => {
    const text = '{"a":1}\n\nand also {"b":2} <- ignore this';
    expect(parseJsonLoose<{ a: number }>(text)).toEqual({ a: 1 });
  });

  it("does not break on braces embedded in string values", () => {
    const text = 'prefix {"msg": "use {curly} braces", "n": 7} suffix';
    expect(parseJsonLoose<{ msg: string; n: number }>(text)).toEqual({
      msg: "use {curly} braces",
      n: 7,
    });
  });

  it("handles escaped quotes inside strings", () => {
    const text = '{"q": "he said \\"hi\\"", "n": 1}';
    expect(parseJsonLoose<{ q: string; n: number }>(text)).toEqual({ q: 'he said "hi"', n: 1 });
  });

  it("throws a typed ProviderParseError with a snippet on garbage", () => {
    let err: unknown;
    try {
      parseJsonLoose("no json here at all");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProviderParseError);
    expect((err as ProviderParseError).snippet).toContain("no json");
  });

  it("throws on empty input", () => {
    expect(() => parseJsonLoose("")).toThrow(ProviderParseError);
  });
});
