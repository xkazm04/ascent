// THE METRIC CONTRACT, PINNED. Each test here is one clause of the contract the module states in
// prose at the top of `compare-metrics.ts`: one optimized metric, everything else a declared
// threshold, cost reported both ways with its population inside the number, reliability reported
// twice, and every voided / parked / timed-out lane counted rather than dropped.

import { describe, expect, it } from "vitest";
import {
  CONSTRAINT_IDS,
  LANDED_RATE_MARGIN,
  MAX_MEDIAN_LANE_MS,
  RELIABILITY_N,
  buildComparisonReport,
  declaredConstraints,
  type Constraint,
  type LaneMetricRow,
} from "@/lib/local/compare-metrics";

let seq = 0;
const row = (over: Partial<LaneMetricRow> = {}): LaneMetricRow => ({
  laneId: `lane-${++seq}`,
  armId: "claude",
  transport: "claude",
  outcome: "landed",
  inputTokens: 1000,
  outputTokens: 1000,
  costMicros: 100,
  verifiedPoints: 2,
  verifyVerdict: "verified",
  wallClockMs: 10 * 60 * 1000,
  trialKey: `t-${seq}`,
  ...over,
});

/** One trial worked by both arms, so the pairing the conditioned figures need actually exists. */
const trial = (key: string, claude: Partial<LaneMetricRow>, local: Partial<LaneMetricRow>): LaneMetricRow[] => [
  row({ armId: "claude", transport: "claude", trialKey: key, ...claude }),
  row({ armId: "local", transport: "pi", trialKey: key, ...local }),
];

describe("declaredConstraints", () => {
  it("declares three thresholds and exactly zero optimized metrics", () => {
    const c = declaredConstraints();
    expect(c.map((x) => x.id)).toEqual([CONSTRAINT_IDS.landedRate, CONSTRAINT_IDS.verifyRegression, CONSTRAINT_IDS.wallClock]);
    expect(c.filter((x) => x.kind === "quality")).toHaveLength(2);
    expect(c.filter((x) => x.kind === "operational")).toHaveLength(1);
    expect(c.find((x) => x.id === CONSTRAINT_IDS.landedRate)?.threshold).toBe(LANDED_RATE_MARGIN);
    expect(c.find((x) => x.id === CONSTRAINT_IDS.wallClock)?.threshold).toBe(MAX_MEDIAN_LANE_MS);
  });
});

describe("the optimized metric", () => {
  it("is Claude tokens per verified point, and an arm with no verified points reports NULL", () => {
    const report = buildComparisonReport([
      ...trial("t1", { verifiedPoints: 4 }, { verifiedPoints: 0, outcome: "failed" }),
      ...trial("t2", { verifiedPoints: 4 }, { verifiedPoints: 0, outcome: "failed" }),
    ]);
    const claude = report.arms.find((a) => a.armId === "claude");
    const local = report.arms.find((a) => a.armId === "local");
    expect(claude?.claudeTokensPerVerifiedPoint).toBe((2000 * 2) / 8);
    // Not 0, not Infinity: dividing by no points is not "infinitely efficient".
    expect(local?.claudeTokensPerVerifiedPoint).toBeNull();
    expect(Number.isFinite(local?.claudeTokensPerVerifiedPoint as number)).toBe(false);
  });

  it("an UNMEASURED lane (no scan pair) is not a zero-point lane", () => {
    const report = buildComparisonReport([row({ armId: "a", verifiedPoints: null })]);
    expect(report.arms[0]?.claudeTokensPerVerifiedPoint).toBeNull();
    expect(report.advance).toBeNull();
    expect(report.note).toContain("No arm produced a verified point");
  });

  it("attributes a split arm's whole envelope to Claude — the bias runs against the arm being sold", () => {
    const report = buildComparisonReport([
      row({ armId: "split", transport: "pi", planTransport: "claude", verifiedPoints: 1, inputTokens: 300, outputTokens: 200 }),
    ]);
    expect(report.arms[0]?.claudeTokens).toBe(500);
    expect(report.arms[0]?.localTokens).toBe(0);
  });

  it("honours an explicit per-side split when the caller can record one", () => {
    const report = buildComparisonReport([
      row({ armId: "split", transport: "pi", planTransport: "claude", verifiedPoints: 1, claudeTokens: 120, localTokens: 9000 }),
    ]);
    expect(report.arms[0]?.claudeTokens).toBe(120);
    expect(report.arms[0]?.localTokens).toBe(9000);
    expect(report.arms[0]?.claudeTokensPerVerifiedPoint).toBe(120);
  });
});

describe("constraints gate the advance", () => {
  it("a breached threshold blocks advance EVEN WHEN the optimized metric improved", () => {
    // The local arm is four times cheaper per point and lands a third as often.
    const lanes = [
      ...trial("t1", { verifiedPoints: 2 }, { verifiedPoints: 4, inputTokens: 100, outputTokens: 100 }),
      ...trial("t2", { verifiedPoints: 2 }, { outcome: "failed", verifiedPoints: 0 }),
      ...trial("t3", { verifiedPoints: 2 }, { outcome: "failed", verifiedPoints: 0 }),
    ];
    const report = buildComparisonReport(lanes);
    const local = report.arms.find((a) => a.armId === "local");
    const claude = report.arms.find((a) => a.armId === "claude");
    expect(local?.claudeTokensPerVerifiedPoint).toBeLessThan(claude?.claudeTokensPerVerifiedPoint as number);
    expect(report.advance).toBe("claude");
  });

  it("advance is null WITH A NOTE when every arm breaches one", () => {
    const slow = { wallClockMs: MAX_MEDIAN_LANE_MS + 1 };
    const report = buildComparisonReport([
      ...trial("t1", slow, slow),
      ...trial("t2", slow, slow),
    ]);
    expect(report.advance).toBeNull();
    expect(report.note).toContain("No arm advances");
    expect(report.note).toContain("claude");
    expect(report.note).toContain("local");
    expect(report.constraints.some((v) => v.constraint.id === CONSTRAINT_IDS.wallClock && v.cleared === false)).toBe(true);
  });

  it("a paired verify-verdict regression is a breach on its own", () => {
    const report = buildComparisonReport([
      ...trial("t1", { verifyVerdict: "verified" }, { verifyVerdict: "rejected", outcome: "failed" }),
      ...trial("t2", { verifyVerdict: "verified" }, { verifyVerdict: "verified", verifiedPoints: 8, inputTokens: 10, outputTokens: 10 }),
    ]);
    expect(report.advance).toBe("claude");
  });

  it("an UNMEASURED constraint never counts as cleared", () => {
    const mine: Constraint[] = [
      { id: "nobody-can-observe-this", label: "Made-up", direction: "at-most", threshold: 1, kind: "quality" },
    ];
    const report = buildComparisonReport([row({ armId: "a" })], mine);
    expect(report.constraints[0]?.observed).toBeNull();
    expect(report.constraints[0]?.cleared).toBeNull();
    expect(report.advance).toBeNull();
  });

  it("caller-supplied constraints replace the declared set rather than joining it", () => {
    const loose: Constraint[] = [
      { id: CONSTRAINT_IDS.wallClock, label: "Median lane under a week", direction: "at-most", threshold: 7 * 24 * 3600_000, kind: "operational" },
    ];
    const slow = { wallClockMs: MAX_MEDIAN_LANE_MS + 1 };
    const report = buildComparisonReport([...trial("t1", slow, slow)], loose);
    expect(report.constraints).toHaveLength(1);
    expect(report.advance).not.toBeNull();
  });
});

describe("cost, both ways", () => {
  it("reports the unconditioned primary and the conditioned subset, each carrying its own n", () => {
    const lanes = [
      ...trial("t1", { costMicros: 100 }, { costMicros: 10 }),
      ...trial("t2", { costMicros: 300 }, { costMicros: 50, outcome: "failed", verifiedPoints: 0 }),
    ];
    const report = buildComparisonReport(lanes);
    const claude = report.arms.find((a) => a.armId === "claude");
    expect(claude?.costAllCompleted).toEqual({ value: 200, n: 2, predicate: expect.stringContaining("completed") });
    // Only t1 had every arm land, so the conditioned figure covers exactly one lane and SAYS SO.
    expect(claude?.costConditioned.value).toBe(100);
    expect(claude?.costConditioned.n).toBe(1);
    expect(claude?.costConditioned.predicate).toContain("1 of 2");
  });

  it("the conditioned figure is structurally inseparable from its subset size", () => {
    const report = buildComparisonReport([...trial("t1", {}, { outcome: "failed" })]);
    for (const arm of report.arms) {
      // There is no shape of this value that omits `n` — it is a field of the number, not a footnote.
      expect(Object.keys(arm.costConditioned).sort()).toEqual(["n", "predicate", "value"]);
      expect(arm.costConditioned.n).toBe(0);
      expect(arm.costConditioned.value).toBeNull();
    }
  });

  it("a lane that reported no cost is absent from the mean rather than counted as free", () => {
    const report = buildComparisonReport([
      row({ armId: "a", costMicros: 200 }),
      row({ armId: "a", costMicros: null }),
    ]);
    expect(report.arms[0]?.costAllCompleted).toMatchObject({ value: 200, n: 1 });
  });
});

describe("reliability, twice", () => {
  it("any-of-N and all-of-N differ for the SAME trials, and both carry N", () => {
    const lanes = [
      row({ armId: "a", outcome: "landed", trialKey: "t1" }),
      row({ armId: "a", outcome: "landed", trialKey: "t2" }),
      row({ armId: "a", outcome: "failed", trialKey: "t3" }),
    ];
    const r = buildComparisonReport(lanes).arms[0]?.reliability;
    expect(r?.perTrial).toMatchObject({ value: 2 / 3, n: 3 });
    expect(r?.n).toBe(RELIABILITY_N);
    expect(r?.anyOfN).toBeCloseTo(1 - Math.pow(1 / 3, 3), 6);
    expect(r?.allOfN).toBeCloseTo(Math.pow(2 / 3, 3), 6);
    expect(r?.anyOfN).not.toBeCloseTo(r?.allOfN as number, 2);
    // Compounded from a rate, so it assumes independence — and says so.
    expect(r?.modelled).toBe(true);
  });

  it("is OBSERVED, not modelled, when a trial actually ran N attempts", () => {
    const lanes = [
      row({ armId: "a", outcome: "landed", trialKey: "t1" }),
      row({ armId: "a", outcome: "landed", trialKey: "t1" }),
      row({ armId: "a", outcome: "failed", trialKey: "t1" }),
    ];
    const r = buildComparisonReport(lanes).arms[0]?.reliability;
    expect(r?.modelled).toBe(false);
    expect(r?.anyOfN).toBe(1);
    expect(r?.allOfN).toBe(0);
  });
});

describe("nothing is dropped", () => {
  it("counts voided, parked and timed-out lanes as outcomes", () => {
    const lanes = [
      row({ armId: "a", outcome: "landed" }),
      row({ armId: "a", outcome: "void", voidReason: "Void — edited src/x.test.ts", verifiedPoints: 99 }),
      row({ armId: "a", outcome: "parked" }),
      row({ armId: "a", outcome: "timed-out" }),
      row({ armId: "a", outcome: "incomplete" }),
    ];
    const arm = buildComparisonReport(lanes).arms[0];
    expect({ landed: arm?.landed, voided: arm?.voided, parked: arm?.parked, timedOut: arm?.timedOut }).toEqual({
      landed: 1,
      voided: 1,
      parked: 1,
      timedOut: 1,
    });
    // The voided lane's 99 points are NOT credited — that is what "excluded from the metric" means.
    // The landed, parked and timed-out lanes each contribute their measured 2: a rescan that moved
    // the score moved it however the lane ended. Only the VOID lane is uncredited.
    expect(arm?.verifiedPoints).toBe(6);
    // …and it still drags the reliability denominator down. A silently discarded void lane would
    // flatter the arm that produced it.
    expect(arm?.reliability.perTrial).toMatchObject({ value: 1 / 3, n: 3 });
  });

  it("a parked lane counts as a FAILURE for an arm below the capability floor", () => {
    const base = [row({ armId: "f", outcome: "landed" }), row({ armId: "f", outcome: "parked" })];
    const above = buildComparisonReport(base).arms[0]?.reliability.perTrial;
    const below = buildComparisonReport(base.map((r) => ({ ...r, belowFloor: true }))).arms[0]?.reliability.perTrial;
    expect(above).toMatchObject({ value: 1, n: 1 });
    expect(below).toMatchObject({ value: 0.5, n: 2 });
    expect(buildComparisonReport(base.map((r) => ({ ...r, belowFloor: true }))).arms[0]?.belowFloor).toBe(true);
  });

  it("an empty run is an empty report, not a crash", () => {
    const report = buildComparisonReport([]);
    expect(report.arms).toEqual([]);
    expect(report.advance).toBeNull();
    expect(report.note).toContain("nothing to compare");
  });
});
