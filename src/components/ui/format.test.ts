import { describe, it, expect } from "vitest";
import { deltaHex, signedDelta, fmtDelta } from "./format";

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
