import { describe, expect, it } from "vitest";

import {
  GREEN_MIN_SCORE,
  fleetGreenness,
  isContested,
  isDimGreen,
  repoGreenness,
  type DimScore,
} from "@/lib/maturity/green";

const dims = (...scores: number[]): DimScore[] => scores.map((score, i) => ({ dimId: `D${i + 1}`, score }));

describe("the green band", () => {
  it("is the top level, derived from LEVELS rather than a hardcoded 85", () => {
    expect(GREEN_MIN_SCORE).toBe(85);
    expect(isDimGreen(GREEN_MIN_SCORE)).toBe(true);
    expect(isDimGreen(GREEN_MIN_SCORE - 1)).toBe(false);
    expect(isDimGreen(100)).toBe(true);
  });

  it("rounds the way levelForScore does, so the boundary cannot drift between them", () => {
    expect(isDimGreen(84.5)).toBe(true); // rounds to 85
    expect(isDimGreen(84.4)).toBe(false);
  });
});

describe("repoGreenness", () => {
  it("is green only when EVERY dimension cleared the band", () => {
    expect(repoGreenness("a/b", dims(90, 95, 100)).green).toBe(true);
    expect(repoGreenness("a/b", dims(90, 95, 84)).green).toBe(false);
  });

  it("does not let a strong overall carry a weak dimension", () => {
    // Mean is ~85 and would read as green on an overall-score test; one dimension is at L2.
    const r = repoGreenness("a/b", dims(100, 100, 100, 100, 30));
    expect(r.green).toBe(false);
    expect(r.gaps.map((g) => g.dimId)).toEqual(["D5"]);
  });

  it("treats an unscanned repo as NOT green, and says why", () => {
    // The dangerous alternative is vacuous truth: zero dimensions, zero gaps, "green".
    const r = repoGreenness("a/b", []);
    expect(r.green).toBe(false);
    expect(r.unscanned).toBe(true);
    expect(r.gaps).toEqual([]);
  });

  it("reports the distance to the band and orders the widest gap first", () => {
    const r = repoGreenness("a/b", [
      { dimId: "D1", score: 80 },
      { dimId: "D2", score: 40 },
      { dimId: "D3", score: 90 },
    ]);
    expect(r.gaps.map((g) => [g.dimId, g.points])).toEqual([
      ["D2", 45],
      ["D1", 5],
    ]);
    expect(r.gaps[0]!.level).toBe("L2");
    expect(r.debt).toBe(50);
  });
});

describe("contested — the model out-argued the detector and was clamped", () => {
  // See docs/SCORING-VALIDITY.md. The engine lets the LLM move a dimension by at most ±4 points, so
  // when |llm - signal| exceeds the band the score you are reading is the DETECTOR's verdict over
  // the model's objection. For a loop driving a number to a target, that is the signature of the
  // number having been satisfied rather than earned.
  // D2 rather than D4: D4 is claim-scored since r9 and is never contested by design (see the last
  // describe block); these tests exercise the GENERIC guardband rule on an ordinary dimension.
  const contestedDim = { dimId: "D2", score: 88, signalScore: 90, llmScore: 40 };

  it("needs both scores — an absent answer is not suspicion", () => {
    expect(isContested({ dimId: "D2", score: 88 })).toBe(false);
    expect(isContested({ dimId: "D2", score: 88, signalScore: 90 })).toBe(false);
  });

  it("fires only past the guardband, in either direction", () => {
    expect(isContested({ dimId: "D2", score: 50, signalScore: 50, llmScore: 56 })).toBe(false); // exactly 6
    expect(isContested({ dimId: "D2", score: 50, signalScore: 50, llmScore: 57 })).toBe(true);
    expect(isContested({ dimId: "D2", score: 50, signalScore: 50, llmScore: 43 })).toBe(true);
  });

  it("uses the doubled band for a flagged dimension", () => {
    const d = { dimId: "D2", score: 50, signalScore: 50, llmScore: 60 };
    expect(isContested(d)).toBe(true);
    expect(isContested({ ...d, widened: true })).toBe(false); // 10 <= 12
  });

  it("keeps a numerically-green dimension OUT of green when the clamp bound", () => {
    // The whole point: 88 clears the band, and the model said 40. Counting this as arrived would let
    // a loop declare victory on the one reading that suggests it satisfied the detector instead.
    const r = repoGreenness("a/b", [contestedDim]);
    expect(r.green).toBe(false);
    expect(r.contested).toEqual(["D2"]);
    expect(r.gaps[0]).toMatchObject({ dimId: "D2", contested: true });
  });

  it("gives a contested-but-green dimension zero points, never a negative debt", () => {
    const r = repoGreenness("a/b", [contestedDim]);
    expect(r.gaps[0]!.points).toBe(0);
    expect(r.debt).toBe(0);
  });

  it("does not contest an agreeing dimension", () => {
    const r = repoGreenness("a/b", [{ dimId: "D2", score: 88, signalScore: 90, llmScore: 87 }]);
    expect(r.green).toBe(true);
    expect(r.contested).toEqual([]);
  });
});

describe("fleetGreenness", () => {
  it("is green only when every repo is", () => {
    const all = [repoGreenness("a/b", dims(90)), repoGreenness("c/d", dims(95))];
    expect(fleetGreenness(all).green).toBe(true);

    const mixed = [repoGreenness("a/b", dims(90)), repoGreenness("c/d", dims(50))];
    const f = fleetGreenness(mixed);
    expect(f.green).toBe(false);
    expect(f.greenCount).toBe(1);
    expect(f.remaining.map((r) => r.fullName)).toEqual(["c/d"]);
  });

  it("refuses vacuous truth: an EMPTY scope is not green", () => {
    // A misconfigured scope — nothing paired, nothing watched — must never read as a finished job.
    expect(fleetGreenness([]).green).toBe(false);
  });

  it("orders remaining work by debt so bounded cycles are spent where the distance is", () => {
    const f = fleetGreenness([
      repoGreenness("small/gap", dims(80)),
      repoGreenness("big/gap", dims(20)),
      repoGreenness("is/green", dims(99)),
    ]);
    expect(f.remaining.map((r) => r.fullName)).toEqual(["big/gap", "small/gap"]);
    expect(f.totalDebt).toBe(65 + 5);
  });
});

describe("contested does not apply to a claim-scored dimension", () => {
  it("never flags D4: its model score field is ignored by the engine, so a gap there is noise", () => {
    // The first live r9 run flagged kp's D4 on signal 0 vs llm 15 — a number nothing acted on.
    expect(isContested({ dimId: "D4", score: 15, signalScore: 0, llmScore: 15 })).toBe(false);
    expect(repoGreenness("a/b", [{ dimId: "D4", score: 90, signalScore: 90, llmScore: 20 }]).green).toBe(true);
  });
});
