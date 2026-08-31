// The attribution rule — the one place that decides whether a score difference may be called a lift.
//
// Every case here is a way the loop could otherwise report work it did not do: a pair straddling the
// mock floor (two different rulers), a real pair inside the model's measured run-to-run wobble, and
// the mirror image of both — a regression that is equally unattributable and must not be reported
// either. The rule is deliberately symmetric, so the negative-delta cases carry as much weight as the
// positive ones.

import { describe, expect, it } from "vitest";
import {
  attributeDelivered,
  attributeDelta,
  attributeDimension,
  attributeScores,
  attributionChip,
  attributionLabel,
  foldIsComparable,
  foldPointsFor,
  integrityNotes,
  isAttributableGain,
  isRealEngine,
  MOCK_ENGINE,
  SCORE_NOISE_BAND,
} from "./attribution";
import { SCORE_BLEND } from "@/lib/maturity/model";

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

describe("a folded dimension is not a lift", () => {
  // D2/D3/D4 carry credit for tooling that is installed rather than committed. A pair whose two ends
  // folded those platform signals differently moved for a reason that has nothing to do with the
  // repository — the fourth way a number moves, and the one the loop creates itself by rescanning
  // from a worktree.
  const fold = (points: number) => ({
    engineProvider: "anthropic",
    engineDegraded: false,
    platformSignals: {
      source: "carried" as const,
      observedAt: "2026-08-20T00:00:00.000Z",
      dims: [{ dimId: "D3" as const, points, signals: [] }],
    },
  });
  const noFold = { engineProvider: "anthropic", engineDegraded: false, platformSignals: { source: "unavailable" as const, observedAt: null, dims: [] } };
  const unknown = { engineProvider: "anthropic", engineDegraded: false };
  const BIG = SCORE_NOISE_BAND + 10;

  it("refuses a fold dimension whose credit differs across the pair, however far it moved", () => {
    expect(attributeDimension("D3", BIG, noFold, fold(43))).toEqual({ kind: "unmeasured" });
    // And symmetrically: losing the fold is not a regression either.
    expect(attributeDimension("D3", -BIG, fold(43), noFold)).toEqual({ kind: "unmeasured" });
  });

  it("judges the SAME fold on both ends normally — the residue is real repository movement", () => {
    // This is what carrying the fold forward buys: the pair becomes comparable again, so honest work
    // on a folded dimension is still reported as a lift.
    expect(attributeDimension("D3", BIG, fold(43), fold(43))).toEqual({ kind: "attributable", delta: BIG });
    expect(attributeDimension("D3", 1, fold(43), fold(43))).toEqual({ kind: "within-noise", delta: 1 });
  });

  it("leaves a NON-fold dimension entirely alone", () => {
    expect(attributeDimension("D1", BIG, noFold, fold(43))).toEqual({ kind: "attributable", delta: BIG });
  });

  it("treats two unknown ends as comparable — a refusal invented from absent data is the same error", () => {
    expect(attributeDimension("D3", BIG, unknown, unknown)).toEqual({ kind: "attributable", delta: BIG });
  });

  it("refuses an unknown end facing a real fold, but not one facing a zero fold", () => {
    // Unknown vs a credited fold: we cannot show the credit landed on both sides.
    expect(attributeDimension("D3", BIG, unknown, fold(43))).toEqual({ kind: "unmeasured" });
    // Unknown vs a fold that added nothing: nothing was carried, so nothing could have moved.
    expect(attributeDimension("D3", BIG, unknown, noFold)).toEqual({ kind: "attributable", delta: BIG });
  });

  it("still defers to the engine rule — a mock end is refused before the fold is even consulted", () => {
    const mockFold = { ...fold(43), engineProvider: MOCK_ENGINE };
    expect(attributeDimension("D3", BIG, mockFold, fold(43)).kind).toBe("mock-scan");
  });

  it("reads a fold dimension the record never mentions as zero, not as unknown", () => {
    // The record IS present; a dimension absent from it earned nothing, which is a measurement.
    expect(foldPointsFor(noFold, "D3")).toBe(0);
    expect(foldPointsFor(fold(43), "D2")).toBe(0);
    expect(foldPointsFor(unknown, "D3")).toBeNull();
    expect(foldIsComparable(noFold, fold(0), "D3")).toBe(true);
  });
});

describe("foldIsComparable — D9 answers to the security INPUTS, not to fold points", () => {
  const legacy = real(50);
  const github = { ...real(50), platformSignals: { source: "observed" as const, observedAt: "2026-08-28T00:00:00Z", dims: [] } };
  const carriedWith = {
    ...real(50),
    platformSignals: { source: "carried" as const, observedAt: "2026-08-28T00:00:00Z", fromScanId: "s1", dims: [], securityInputs: { governance: null, posture: null, apps: null } },
  };
  const carriedWithout = { ...real(50), platformSignals: { source: "carried" as const, observedAt: "2026-08-28T00:00:00Z", fromScanId: "s1", dims: [] } };
  const blind = { ...real(50), platformSignals: { source: "unavailable" as const, observedAt: null, dims: [] } };

  it("a GitHub scan against a blind worktree rescan is NOT comparable — the wave-2 D9 collapse", () => {
    expect(foldIsComparable(github, blind, "D9")).toBe(false);
    expect(foldIsComparable(legacy, blind, "D9")).toBe(false);
    expect(foldIsComparable(github, carriedWithout, "D9")).toBe(false);
    expect(attributeDimension("D9", -42, legacy, blind)).toEqual({ kind: "unmeasured" });
  });

  it("a carried security reading puts the rescan on the before-scan's ruler", () => {
    expect(foldIsComparable(github, carriedWith, "D9")).toBe(true);
    expect(foldIsComparable(legacy, carriedWith, "D9")).toBe(true);
    expect(foldIsComparable(carriedWith, carriedWith, "D9")).toBe(true);
    expect(attributeDimension("D9", 12, github, carriedWith)).toEqual({ kind: "attributable", delta: 12 });
  });

  it("two blind ends, or two legacy ends, are as comparable as they ever were", () => {
    expect(foldIsComparable(blind, blind, "D9")).toBe(true);
    expect(foldIsComparable(legacy, legacy, "D9")).toBe(true);
  });
});

// The "not measured" disclosure. It rides the SAME record the D9 hatch and the widened dims ride, so
// the report header's integrity chip renders it with no new UI: one record, one wording.
describe("integrityNotes — an unmeasured dimension is disclosed, never silently dropped", () => {
  it("names the dimensions and says a low number there is missing evidence, not a finding", () => {
    const notes = integrityNotes({ d9Unmeasurable: false, widenedDims: [], unmeasuredDims: ["D2", "D3", "D4"], effectiveBlend: SCORE_BLEND });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.label).toBe("D2, D3, D4 not measured");
    expect(notes[0]!.hint).toMatch(/MISSING EVIDENCE, not a finding/);
  });

  it("says nothing at all on a scan that observed everything", () => {
    expect(integrityNotes({ d9Unmeasurable: false, widenedDims: [], effectiveBlend: SCORE_BLEND })).toEqual([]);
  });
});

// ── THE FIFTH WAY A NUMBER MOVES: the two ends were not taken on the same base ───────────────────
//
// A pair whose ends sit on divergent commits measured two different trees. Run a97baf88 (2026-08-30):
// `kp` read 92 → 84 because a person switched the paired checkout's branch between the two scans, and
// the loop published "Regressed on agentic workflows" for it. The refusal is symmetric — a gain
// across a branch swap is exactly as unattributable as a loss — and it fires ONLY on proof.
describe("an incomparable base", () => {
  it("refuses the pair in both directions, and says why", () => {
    for (const [b, a] of [
      [real(92), real(84)],
      [real(84), real(92)],
    ] as const) {
      const v = attributeScores(b, a, "diverged");
      expect(v).toEqual({ kind: "unmeasured", reason: "base" });
      expect(attributionLabel(v)).toContain("different bases");
      expect(attributionChip(v)).toBe("different bases");
    }
  });

  it("does not refuse a pair whose ends share a base, or one git could not answer for", () => {
    // `unknown` is the default and the common case — an unknown base is not a differing base.
    expect(attributeScores(real(50), real(62), "shared")).toEqual({ kind: "attributable", delta: 12 });
    expect(attributeScores(real(50), real(62), "unknown")).toEqual({ kind: "attributable", delta: 12 });
    expect(attributeScores(real(50), real(62))).toEqual({ kind: "attributable", delta: 12 });
  });

  it("outranks the noise band and the mock floor — there is no delta to judge", () => {
    // Not "a small movement" and not "two rulers": no comparison happened at all.
    expect(attributeScores(real(50), real(51), "diverged")).toEqual({ kind: "unmeasured", reason: "base" });
    expect(attributeScores(mock(50), real(62), "diverged")).toEqual({ kind: "unmeasured", reason: "base" });
  });

  it("still reports a missing end as plain unmeasured — nothing to compare is not a base finding", () => {
    expect(attributeScores(null, real(62), "diverged")).toEqual({ kind: "unmeasured" });
    expect(attributionLabel({ kind: "unmeasured" })).toBe("not measured");
  });

  it("refuses every DIMENSION of the pair, not just the platform-folded three", () => {
    // A fold mismatch is narrow because it IS narrow: it moves D2/D3/D4 and leaves six honest. A
    // branch swap changes every file the scan read.
    for (const dim of ["D1", "D4", "D7", "D9"]) {
      expect(attributeDimension(dim, -8, real(92), real(84), "diverged")).toEqual({ kind: "unmeasured", reason: "base" });
      expect(attributeDimension(dim, -8, real(92), real(84), "shared")).toEqual({ kind: "attributable", delta: -8 });
    }
  });

  it("refuses a bare delta too, so the ledger and the resolve rule cannot disagree", () => {
    expect(attributeDelta(-8, real(92), real(84), "diverged")).toEqual({ kind: "unmeasured", reason: "base" });
    expect(attributeDelta(-8, real(92), real(84), "unknown")).toEqual({ kind: "attributable", delta: -8 });
  });

  it("keeps the durability rule underneath it: a refused pair is not upgraded by commits", () => {
    expect(attributeDelivered(real(92), real(84), 3, "diverged")).toEqual({ kind: "unmeasured", reason: "base" });
    expect(attributeDelivered(real(92), real(84), 0, "diverged")).toEqual({ kind: "unmeasured", reason: "base" });
  });
});
