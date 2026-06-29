import { describe, it, expect } from "vitest";
import { deltaHex, signedDelta, fmtDelta, shortDate, shortDateSafe } from "./format";

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
});

describe("short date formatters", () => {
  it("shortDate emits the {month:'short', day:'numeric'} locale string (single-sourced)", () => {
    const d = new Date(2024, 5, 9); // local date — no TZ ambiguity
    // Locale-agnostic: assert the helper is exactly the inlined call it replaced.
    expect(shortDate(d)).toBe(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
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
