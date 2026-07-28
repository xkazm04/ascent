import { describe, it, expect } from "vitest";
import { SCORE_NOISE_BAND, isWithinNoise, classifyDelta, postureTransition, POSTURE_ENTER, POSTURE_LEAVE } from "./noise";

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

// The posture quadrant cuts at exactly 50 per axis, so a repo at 49/51 flips its LABEL on a re-scan of
// an unchanged commit — and a label flip fires a critical alert and rewrites the briefing headline,
// which is louder than any numeric wobble. postureTransition damps the ANNOUNCEMENT only; postureFor
// stays pure (asserted in model.test.ts), so nothing re-labels. These pin the corridor boundaries,
// because a drift back toward "any crossing is news" would silently restore the wobble alerts.
describe("posture transition hysteresis", () => {
  const at = (adoption: number, rigor: number) => ({ adoption, rigor });

  it("is never news when the posture id did not change", () => {
    expect(postureTransition("ai-native", "ai-native", at(80, 80))).toBe("held");
    // …not even when the axes are nowhere near the corridor.
    expect(postureTransition("getting-started", "getting-started", at(10, 10))).toBe("held");
  });

  it("holds a label flip driven entirely from inside the 48-52 corridor", () => {
    // The exact wobble case: both axes sit on the cut, the quadrant technically changed, no news.
    expect(postureTransition("getting-started", "ai-native", at(50, 51))).toBe("held");
    expect(postureTransition("ai-native", "getting-started", at(49, 48))).toBe("held");
  });

  it("announces once an axis is clear of the corridor — enter high, leave low", () => {
    expect(postureTransition("getting-started", "ai-native", at(POSTURE_ENTER, 51))).toBe("entered");
    expect(postureTransition("ai-native", "ungoverned", at(60, POSTURE_LEAVE - 1))).toBe("left");
  });

  it("is asymmetric: the entry and exit cuts do not touch, so a climb is not un-announced by wobble", () => {
    // A repo that entered at 52 has to fall below 48 — not merely back under 52 — before the exit is
    // announced. Between the two cuts nothing is reported, which is the whole point of hysteresis.
    expect(POSTURE_LEAVE).toBeLessThan(POSTURE_ENTER);
    expect(postureTransition("ai-native", "getting-started", at(POSTURE_ENTER - 1, 49))).toBe("held");
  });
});
