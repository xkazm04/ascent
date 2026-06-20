import { describe, it, expect } from "vitest";
import { SCORE_NOISE_BAND, isWithinNoise, classifyDelta } from "./noise";

describe("score-noise band", () => {
  it("treats |delta| <= band (incl. 0) as within noise", () => {
    expect(isWithinNoise(0)).toBe(true);
    expect(isWithinNoise(SCORE_NOISE_BAND)).toBe(true);
    expect(isWithinNoise(-SCORE_NOISE_BAND)).toBe(true);
  });

  it("treats |delta| > band as real movement", () => {
    expect(isWithinNoise(SCORE_NOISE_BAND + 1)).toBe(false);
    expect(isWithinNoise(-(SCORE_NOISE_BAND + 1))).toBe(false);
  });

  it("classifies direction only outside the noise band", () => {
    expect(classifyDelta(0)).toBe("noise");
    expect(classifyDelta(1)).toBe("noise");
    expect(classifyDelta(-1)).toBe("noise");
    expect(classifyDelta(8)).toBe("up");
    expect(classifyDelta(-8)).toBe("down");
  });
});
