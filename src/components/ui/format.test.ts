import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { deltaHex, signedDelta, fmtDelta, toneFor, shortDate, shortDateSafe, DIRECTION_TONE } from "./format";

describe("delta formatters (noise-aware)", () => {
  it("deltaHex mutes flat + within-noise deltas to slate", () => {
    expect(deltaHex(0)).toBe("#94a3b8");
    expect(deltaHex(1)).toBe("#94a3b8");
    expect(deltaHex(-2)).toBe("#94a3b8");
    expect(deltaHex(8)).toBe("#84cc16");
    expect(deltaHex(-8)).toBe("#f97316");
  });

  it("signedDelta is a plain signed number", () => {
    expect(signedDelta(8)).toBe("+8");
    expect(signedDelta(-5)).toBe("-5");
    expect(signedDelta(0)).toBe("0");
  });

  it("fmtDelta marks within-noise with ≈ and real moves with arrows", () => {
    expect(fmtDelta(0)).toBe("→0");
    expect(fmtDelta(1)).toBe("≈+1");
    expect(fmtDelta(-2)).toBe("≈-2");
    expect(fmtDelta(8)).toBe("▲+8");
    expect(fmtDelta(-5)).toBe("▼-5");
  });

  it("toneFor mutes flat + within-noise deltas to 'flat' like its sibling formatters", () => {
    expect(toneFor(0)).toBe("flat");
    expect(toneFor(1)).toBe("flat");
    expect(toneFor(-2)).toBe("flat");
    expect(toneFor(8)).toBe("rising");
    expect(toneFor(-5)).toBe("falling");
  });

  it("non-finite deltas (NaN/Infinity) render as a neutral placeholder, never a confident decline", () => {
    // Before the guard: toneFor(NaN) fell through to "falling" (NaN > 0 is false), deltaHex(NaN)
    // rendered the orange "falling" hex, and fmtDelta(NaN) rendered "▼NaN" — a styled, confident wrong
    // decline arrow for what is actually a measurement gap (missing baseline / divide-by-zero).
    expect(toneFor(NaN)).toBe("flat");
    expect(toneFor(Infinity)).toBe("flat");
    expect(toneFor(-Infinity)).toBe("flat");
    expect(deltaHex(NaN)).toBe(DIRECTION_TONE.flat.color);
    expect(deltaHex(Infinity)).toBe(DIRECTION_TONE.flat.color);
    expect(fmtDelta(NaN)).toBe("—");
    expect(fmtDelta(Infinity)).toBe("—");
    expect(fmtDelta(-Infinity)).toBe("—");
    expect(signedDelta(NaN)).toBe("—");
    expect(signedDelta(Infinity)).toBe("—");
  });

  it("DIRECTION_TONE hexes stay paired with the --color-tone-* CSS tokens (change BOTH together)", () => {
    // TS keeps literal hex (inline styles + tests can't resolve var()); globals.css re-declares the
    // triad as tokens for CSS-side surfaces. This pins the pairing so a rebrand can't move one side.
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain(`--color-tone-rising: ${DIRECTION_TONE.rising.color}`);
    expect(css).toContain(`--color-tone-falling: ${DIRECTION_TONE.falling.color}`);
    expect(css).toContain(`--color-tone-flat: ${DIRECTION_TONE.flat.color}`);
  });
});

describe("short date formatters", () => {
  it("shortDate is pinned to en-US so SSR prerender and every browser locale agree", () => {
    const d = new Date(2024, 5, 9); // local date — no TZ ambiguity
    // Pinned (not the runtime locale): an `undefined` locale renders the SERVER's ICU locale during
    // prerender, then hydrates to the viewer's — a mismatch. The exact string is the contract.
    expect(shortDate(d)).toBe("Jun 9");
  });

  it("shortDateSafe returns '' for an unparseable/invalid value (the guard the call sites need)", () => {
    expect(shortDateSafe("not a date")).toBe("");
    expect(shortDateSafe("")).toBe("");
    expect(shortDateSafe(NaN)).toBe("");
  });

  it("shortDateSafe equals shortDate(new Date(value)) for a valid ISO timestamp", () => {
    const iso = "2024-06-09T12:00:00.000Z";
    expect(shortDateSafe(iso)).toBe(shortDate(new Date(iso)));
    expect(shortDateSafe(iso)).not.toBe("");
  });
});
