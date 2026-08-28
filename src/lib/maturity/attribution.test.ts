// The attribution rule — the one place that decides whether a score difference may be called a lift.
//
// Every case here is a way the loop could otherwise report work it did not do: a pair straddling the
// mock floor (two different rulers), a real pair inside the model's measured run-to-run wobble, and
// the mirror image of both — a regression that is equally unattributable and must not be reported
// either. The rule is deliberately symmetric, so the negative-delta cases carry as much weight as the
// positive ones.

import { describe, expect, it } from "vitest";
import {
  attributeDelta,
  attributeScores,
  attributionChip,
  attributionLabel,
  isAttributableGain,
  isRealEngine,
  MOCK_ENGINE,
  SCORE_NOISE_BAND,
} from "./attribution";

const real = (overallScore: number) => ({ overallScore, engineProvider: "anthropic", engineDegraded: false });
const mock = (overallScore: number) => ({ overallScore, engineProvider: MOCK_ENGINE, engineDegraded: false });
const degraded = (overallScore: number) => ({ overallScore, engineProvider: MOCK_ENGINE, engineDegraded: true });

describe("isRealEngine", () => {
  it("is the mock name and nothing else — a legacy row with no degraded flag is still judged", () => {
    expect(isRealEngine({ engineProvider: "anthropic" })).toBe(true);
    expect(isRealEngine({ engineProvider: MOCK_ENGINE })).toBe(false);
    // Unknown degraded (a pre-migration row) never upgrades a mock engine into a real one.
    expect(isRealEngine({ engineProvider: MOCK_ENGINE, engineDegraded: null })).toBe(false);
    expect(isRealEngine(null)).toBe(false);
  });
});

describe("attributeScores — a lift needs a real pair AND a movement past the noise band", () => {
  it("a REAL pair moving further than the band is attributable, with the signed delta", () => {
    expect(attributeScores(real(60), real(60 + SCORE_NOISE_BAND + 1))).toEqual({
      kind: "attributable",
      delta: SCORE_NOISE_BAND + 1,
    });
  });

  it("a REAL pair moving exactly the band is NOT attributable — the band is exclusive", () => {
    const v = attributeScores(real(60), real(60 + SCORE_NOISE_BAND));
    expect(v).toEqual({ kind: "within-noise", delta: SCORE_NOISE_BAND });
    expect(isAttributableGain(v)).toBe(false);
  });

  it("a REAL pair that did not move at all is within-noise, not a zero lift", () => {
    expect(attributeScores(real(60), real(60))).toEqual({ kind: "within-noise", delta: 0 });
  });

  it("a small REGRESSION is refused on the same grounds — the rule is symmetric", () => {
    expect(attributeScores(real(60), real(60 - SCORE_NOISE_BAND))).toEqual({
      kind: "within-noise",
      delta: -SCORE_NOISE_BAND,
    });
    expect(attributeScores(real(60), real(60 - SCORE_NOISE_BAND - 1))).toEqual({
      kind: "attributable",
      delta: -(SCORE_NOISE_BAND + 1),
    });
  });

  it("a MOCK pair is never attributable, however far the number travelled", () => {
    expect(attributeScores(mock(10), mock(90))).toEqual({ kind: "mock-scan", delta: 80, degraded: false });
  });

  it("a MIXED pair is a change of ruler, not of repository — mock on either end refuses it", () => {
    expect(attributeScores(mock(40), real(80))).toEqual({ kind: "mock-scan", delta: 40, degraded: false });
    expect(attributeScores(real(80), mock(40))).toEqual({ kind: "mock-scan", delta: -40, degraded: false });
  });

  it("a DEGRADED end is flagged as such — 'the model broke' and 'no model is configured' differ", () => {
    expect(attributeScores(real(40), degraded(80))).toEqual({ kind: "mock-scan", delta: 40, degraded: true });
  });

  it("a missing end is unmeasured, which is not the same answer as zero", () => {
    expect(attributeScores(null, real(80))).toEqual({ kind: "unmeasured" });
    expect(attributeScores(real(80), undefined)).toEqual({ kind: "unmeasured" });
  });

  it("unmeasured wins over mock: a pair that does not exist has no engines to judge", () => {
    expect(attributeScores(null, mock(80))).toEqual({ kind: "unmeasured" });
  });
});

describe("attributeDelta — the same rule for a caller holding a pre-computed movement", () => {
  it("agrees with attributeScores on every branch", () => {
    expect(attributeDelta(SCORE_NOISE_BAND + 1, real(0), real(0))).toEqual({
      kind: "attributable",
      delta: SCORE_NOISE_BAND + 1,
    });
    expect(attributeDelta(1, real(0), real(0))).toEqual({ kind: "within-noise", delta: 1 });
    expect(attributeDelta(40, mock(0), real(0))).toEqual({ kind: "mock-scan", delta: 40, degraded: false });
    expect(attributeDelta(null, real(0), real(0))).toEqual({ kind: "unmeasured" });
    expect(attributeDelta(5, null, real(0))).toEqual({ kind: "unmeasured" });
  });
});

describe("the wording a surface shows instead of a delta", () => {
  it("says nothing when the number speaks for itself", () => {
    const a = attributeScores(real(60), real(70));
    expect(attributionLabel(a)).toBe("");
    expect(attributionChip(a)).toBe("");
  });

  it("names the two mock cases apart, because they call for opposite next moves", () => {
    expect(attributionLabel(attributeScores(mock(1), mock(2)))).toBe("not attributable: mock scan");
    expect(attributionLabel(attributeScores(degraded(1), real(2)))).toContain("the model failed");
  });

  it("states the band it is applying rather than an unexplained refusal", () => {
    expect(attributionLabel(attributeScores(real(60), real(61)))).toBe(`within noise (±${SCORE_NOISE_BAND})`);
    expect(attributionChip(attributeScores(real(60), real(61)))).toBe(`±${SCORE_NOISE_BAND} noise`);
  });

  it("distinguishes 'not measured' from every kind of refusal", () => {
    expect(attributionLabel(attributeScores(null, null))).toBe("not measured");
  });
});
