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

  // --- Recovery + cost guards (recovery-cost guards must stay enforced) ---

  it("recovers valid JSON embedded in extra prose (direct + balanced fast paths)", () => {
    // Well-formed clean JSON parses directly; valid JSON wrapped in prose is still extracted.
    expect(parseJsonLoose<{ ok: true }>('{"ok":true}')).toEqual({ ok: true });
    const prose = 'The assessment is below.\n\n{"score": 73, "ok": true}\n\nLet me know!';
    expect(parseJsonLoose<{ score: number; ok: boolean }>(prose)).toEqual({
      score: 73,
      ok: true,
    });
  });

  it("oversize guard: bails on a >256KB unparseable reply instead of an expensive scan", () => {
    // A truncated/adversarial reply of unclosed "{" past MAX_RECOVERY_BYTES (256KB) must
    // short-circuit BEFORE the O(starts × N) balanced scan. Proven by the byte size in the message.
    const oversize = "{".repeat(300_000); // 300_000 bytes > 256 * 1024 (262_144)
    let err: unknown;
    const start = Date.now();
    try {
      parseJsonLoose(oversize);
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - start;
    expect(err).toBeInstanceOf(ProviderParseError);
    // Message names the byte size -> proves the size short-circuit, not a slow full scan.
    expect((err as ProviderParseError).message).toContain("too large to recover");
    expect((err as ProviderParseError).message).toContain(String(oversize.length));
    // Bounded: the guard returns fast rather than scanning the whole input.
    expect(elapsed).toBeLessThan(1000);
  });

  it("oversize guard: a clean reply of ANY size still parses on the O(N) fast path", () => {
    // The size gate only bounds the recovery scan — a well-formed large reply parses directly.
    const big = "x".repeat(300_000);
    const text = JSON.stringify({ note: big, ok: true });
    expect(text.length).toBeGreaterThan(256 * 1024);
    expect(parseJsonLoose<{ ok: boolean }>(text)).toEqual({ note: big, ok: true });
  });

  it("structural-start cap: many thousands of bare '{' (under size cap) fails fast, bounded", () => {
    // Thousands of unclosed structural starts under MAX_RECOVERY_BYTES exercise the
    // MAX_START_ATTEMPTS (512) cap: balancedParse returns after the cap rather than trying
    // every one of the O(n) starts. There is no JSON value, so it must throw, fast.
    const manyStarts = "{".repeat(50_000); // 50_000 bytes < 256KB, but >> 512 starts
    expect(manyStarts.length).toBeLessThan(256 * 1024);
    let err: unknown;
    const start = Date.now();
    try {
      parseJsonLoose(manyStarts);
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - start;
    expect(err).toBeInstanceOf(ProviderParseError);
    expect((err as ProviderParseError).message).toContain("No JSON value found");
    // Bound proves the 512-start cap holds: an UNCAPPED scan of 50_000 starts (each balanced-parse
    // over up to 50_000 chars ≈ 2.5e9 char-ops) would take tens of seconds. A generous ceiling keeps
    // that protection while tolerating v8-coverage instrumentation, which ~doubles wall-clock (the
    // capped run is ~2s instrumented vs ~0.x s plain) — a tight 1s bound flaked only under --coverage.
    expect(elapsed).toBeLessThan(8000);
  });

  it("structural-start requirement: a reply with no structural start fails fast (no recovery attempt)", () => {
    // No "{" or "[" anywhere -> firstStructuralIndex returns -1 and recovery never scans.
    let err: unknown;
    try {
      parseJsonLoose("plain prose with no json object or array start at all");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProviderParseError);
    expect((err as ProviderParseError).message).toContain("No JSON value found");
  });

  it("structural-start cap: a valid object within the first starts still recovers", () => {
    // The cap must not break the common case: real JSON appears within the first structural chars.
    const text = "prelude {{{ noise " + '{"a":1,"b":2}';
    expect(parseJsonLoose<{ a: number; b: number }>(text)).toEqual({ a: 1, b: 2 });
  });
});
