// STANDING REGRESSIONS — the case the alert layer was silent on.
//
// Campaign evidence (21 runs, repo `kp`): D9 went 93 → 96 → 75 at run 3 and stayed at 75 for eighteen
// further runs. Twenty-one points, permanent, and nothing anywhere reported it — because every
// existing signal is an EVENT (an adjacent-pair diff, a period delta) and the decline had stopped
// moving, while the attribution rule that would otherwise have explained it refuses to CLAIM a delta
// it cannot attribute. These tests pin the shape that must raise its hand and the three that must not.

import { describe, it, expect } from "vitest";
import {
  detectStandingRegressions,
  digestHasSignal,
  buildFleetDigestMessage,
  STANDING_REGRESSION_DROP,
  STANDING_REGRESSION_SCANS,
  type StandingScanPoint,
} from "@/lib/alerts";
import { attributeDelivered, attributeScores, SCORE_NOISE_BAND } from "@/lib/maturity/attribution";

/** Build a newest-first series of one dimension's readings. `scores[0]` is the latest scan.
 *  Scans are spaced one day apart backwards from 2026-08-30. */
function series(dimId: string, scores: number[], engine = "claude"): StandingScanPoint[] {
  return scores.map((score, i) => ({
    id: `s${i}`,
    scannedAt: new Date(Date.UTC(2026, 7, 30 - i)).toISOString(),
    engineProvider: engine,
    dimensions: [{ dimId, score }],
  }));
}

describe("detectStandingRegressions — the kp shape", () => {
  // Runs 21..1, newest first: eighteen further runs at 75, the run-3 fall to 75, then 96 and 93.
  const kp = series("D9", [...Array(19).fill(75), 96, 93]);

  it("raises the twenty-one-point drop that persisted, eighteen scans after it happened", () => {
    const [concern, ...rest] = detectStandingRegressions(kp);
    expect(rest).toHaveLength(0);
    expect(concern.dimId).toBe("D9");
    expect(concern.baseline).toBe(96);
    expect(concern.current).toBe(75);
    expect(concern.drop).toBe(21);
    expect(concern.scansHeld).toBe(19);
  });

  it("measures against the reading BEFORE the fall, not against a three-scan-ago reading inside the plateau", () => {
    // The naive rule ("compare with the scan three back") reads 75 vs 75 and reports nothing — the
    // exact silence this detector exists to break.
    const c = detectStandingRegressions(kp)[0];
    expect(c.baselineAt.slice(0, 10)).toBe("2026-08-11"); // run 2, the 96
    expect(c.since.slice(0, 10)).toBe("2026-08-12"); // run 3, the first reading at 75
  });

  it("words the finding as an observation naming both readings and their dates — no cause claim", () => {
    const c = detectStandingRegressions(kp)[0];
    expect(c.observation).toBe(
      "D9 has held 21 points below its 2026-08-11 reading (96 → 75) across 19 scans since 2026-08-12",
    );
    expect(c.observation).not.toMatch(/because|caused|due to|the loop|lane/i);
  });
});

describe("detectStandingRegressions — what must stay quiet", () => {
  it("a single-scan dip that recovers is not a standing concern", () => {
    // Newest-first: back to 90 after one scan at 65.
    expect(detectStandingRegressions(series("D6", [90, 65, 90, 90, 90]))).toEqual([]);
  });

  it("a fresh drop that has not yet held for the persistence window is not raised", () => {
    // Two scans at the depressed level; the window is three.
    expect(detectStandingRegressions(series("D6", [70, 70, 92, 92, 92]))).toHaveLength(0);
    // The third re-measurement at the same level is what earns the concern.
    expect(detectStandingRegressions(series("D6", [70, 70, 70, 92, 92]))).toHaveLength(1);
    expect(STANDING_REGRESSION_SCANS).toBe(3);
  });

  it("a drop inside the noise band is never raised, however long it holds", () => {
    const wobble = series("D2", [88, 88, 88, 88, 88, 88, 90]); // −2, exactly the measured band
    expect(SCORE_NOISE_BAND).toBe(2);
    expect(STANDING_REGRESSION_DROP).toBeGreaterThan(SCORE_NOISE_BAND);
    expect(detectStandingRegressions(wobble)).toEqual([]);
  });

  it("a repo with no history (or too little to hold a window) raises nothing", () => {
    expect(detectStandingRegressions([])).toEqual([]);
    expect(detectStandingRegressions(series("D9", [40]))).toEqual([]);
    expect(detectStandingRegressions(series("D9", [40, 95, 95]))).toEqual([]); // 3 scans, window needs 4
  });

  it("drops mock-floor readings rather than comparing across two different rulers", () => {
    const mixed: StandingScanPoint[] = [
      ...series("D9", [95, 95, 95, 95]),
      ...series("D9", [40], "mock").map((p) => ({ ...p, id: "mock-old" })),
    ];
    // The only "drop" available is the mock 40 sitting under the real 95s; it must not invert into a
    // concern, and the real series alone holds flat.
    expect(detectStandingRegressions(mixed)).toEqual([]);
  });
});

describe("detectStandingRegressions — independent of attribution", () => {
  it("fires on a drop attribution refuses to claim (the entire point)", () => {
    const kp = series("D9", [...Array(5).fill(75), 96, 93]);
    const before = { engineProvider: "claude", overallScore: 71 };
    const after = { engineProvider: "claude", overallScore: 71 };

    // Attribution is right to say nothing: the OVERALL headline never moved (the D9 collapse was
    // diluted by eight other dimensions), and the work behind the pair was never committed.
    expect(attributeScores(before, after).kind).toBe("within-noise");
    expect(attributeDelivered(before, after, 0).kind).toBe("undelivered");

    // The standing detector consults neither, and raises the decline anyway.
    const concerns = detectStandingRegressions(kp);
    expect(concerns).toHaveLength(1);
    expect(concerns[0].drop).toBe(21);
  });

  it("reports every dimension that qualifies, worst first", () => {
    const points: StandingScanPoint[] = [0, 1, 2, 3, 4, 5].map((i) => ({
      id: `s${i}`,
      scannedAt: new Date(Date.UTC(2026, 7, 30 - i)).toISOString(),
      engineProvider: "claude",
      dimensions:
        i < 4
          ? [{ dimId: "D6", score: 60 }, { dimId: "D9", score: 75 }]
          : [{ dimId: "D6", score: 74 }, { dimId: "D9", score: 96 }],
    }));
    expect(detectStandingRegressions(points).map((c) => [c.dimId, c.drop])).toEqual([
      ["D9", 21],
      ["D6", 14],
    ]);
  });
});

describe("the digest channel carries the standing concern", () => {
  it("a standing concern alone makes an otherwise flat week worth sending", () => {
    const flat = {
      overallDelta: 0,
      levelChanges: 0,
      regressions: 0,
      gainersBeyondNoise: 0,
      creditLow: false,
      controlsFailed: 0,
    };
    expect(digestHasSignal(flat)).toBe(false);
    expect(digestHasSignal({ ...flat, standingConcerns: 1 })).toBe(true);
  });

  it("renders the observation and its evidence, labelled as unattributed", () => {
    const msg = buildFleetDigestMessage({
      org: "acme",
      repoCount: 4,
      scannedCount: 4,
      avgOverall: 71,
      level: "L3 · Managed",
      overallDelta: 0,
      gainers: [],
      regressers: [],
      topRecommendation: null,
      standingConcerns: [
        {
          repo: "acme/kp",
          observation: "D9 has held 21 points below its 2026-08-11 reading (96 → 75) across 19 scans since 2026-08-12",
          evidence: ["disappeared: 3/3 workflows set an explicit permissions: scope"],
        },
      ],
    });
    expect(msg.text).toContain("Standing concerns (1) — observed, cause not attributed:");
    expect(msg.text).toContain("acme/kp — D9 has held 21 points below");
    expect(msg.text).toContain("disappeared: 3/3 workflows");
  });

  it("omits the block entirely when the caller did not compute it, and says so when it did and found none", () => {
    const base = {
      org: "acme",
      repoCount: 1,
      scannedCount: 1,
      avgOverall: 71,
      level: "L3 · Managed",
      overallDelta: 3,
      gainers: [],
      regressers: [],
      topRecommendation: null,
    };
    expect(buildFleetDigestMessage(base).text).not.toMatch(/Standing concerns/);
    expect(buildFleetDigestMessage({ ...base, standingConcerns: [] }).text).toContain("Standing concerns: none open.");
  });
});
