import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  ARCHETYPE_WEIGHTS,
  DIMENSIONS,
  LEVELS,
  LLM_GUARDBAND,
  POSTURE_THRESHOLD,
  SCORE_BLEND,
  SCORING_RUBRIC_VERSION,
  axisMeasured,
  axisScore,
  levelForScore,
  overallScoreFor,
} from "@/lib/maturity/model";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import type { DimensionId } from "@/lib/types";

// The score -> level keystone. Every ring/radar/waterfall/heatmap/badge AND the CI
// gate route through levelForScore, so a one-line band or off-by-one drift mis-colors
// and mis-grades every repo. These tests pin the EXACT band boundaries, the clamp, and
// the Math.round rounding seam so any future retune of LEVELS fails loudly here.
//
// Real thresholds (model.ts): L1 [0,24] L2 [25,44] L3 [45,64] L4 [65,84] L5 [85,100].
// levelForScore = LEVELS.find(s >= band[0] && s <= band[1]) over s = clamp(Math.round(score)).

describe("levelForScore — band boundaries", () => {
  it("maps representative mid-band scores to the right level", () => {
    expect(levelForScore(0).id).toBe("L1");
    expect(levelForScore(12).id).toBe("L1");
    expect(levelForScore(35).id).toBe("L2");
    expect(levelForScore(55).id).toBe("L3");
    expect(levelForScore(75).id).toBe("L4");
    expect(levelForScore(95).id).toBe("L5");
    expect(levelForScore(100).id).toBe("L5");
  });

  // Both sides of every cut — the off-by-one trap. The upper edge of one band and the
  // lower edge of the next must land on opposite levels.
  it("L1/L2 handoff at 24 vs 25", () => {
    expect(levelForScore(24).id).toBe("L1");
    expect(levelForScore(25).id).toBe("L2");
  });

  it("L2/L3 handoff at 44 vs 45", () => {
    expect(levelForScore(44).id).toBe("L2");
    expect(levelForScore(45).id).toBe("L3");
  });

  it("L3/L4 handoff at 64 vs 65", () => {
    expect(levelForScore(64).id).toBe("L3");
    expect(levelForScore(65).id).toBe("L4");
  });

  it("L4/L5 handoff at 84 vs 85", () => {
    expect(levelForScore(84).id).toBe("L4");
    expect(levelForScore(85).id).toBe("L5");
  });
});

describe("levelForScore — clamp to [0,100]", () => {
  it("clamps below 0 to L1", () => {
    expect(levelForScore(-1).id).toBe("L1");
    expect(levelForScore(-10).id).toBe("L1");
    expect(levelForScore(-1000).id).toBe("L1");
  });

  it("clamps above 100 to L5", () => {
    expect(levelForScore(101).id).toBe("L5");
    expect(levelForScore(150).id).toBe("L5");
    expect(levelForScore(99999).id).toBe("L5");
  });
});

describe("levelForScore — Math.round rounding seam", () => {
  // score is rounded BEFORE band lookup, so the seam sits at .5 (Math.round rounds .5 up).
  it("24.4 rounds down to 24 -> L1; 24.5 rounds up to 25 -> L2", () => {
    expect(levelForScore(24.4).id).toBe("L1");
    expect(levelForScore(24.5).id).toBe("L2");
  });

  it("44.5 -> 45 -> L3 and 44.49 -> 44 -> L2", () => {
    expect(levelForScore(44.49).id).toBe("L2");
    expect(levelForScore(44.5).id).toBe("L3");
  });

  it("64.5 -> 65 -> L4 and 84.5 -> 85 -> L5", () => {
    expect(levelForScore(64.5).id).toBe("L4");
    expect(levelForScore(84.5).id).toBe("L5");
  });

  it("a value just under a .5 seam stays in the lower band (84.4 -> L4)", () => {
    expect(levelForScore(84.4).id).toBe("L4");
  });
});

describe("levelForScore — never returns undefined and covers every integer 0..100", () => {
  it("returns a defined level for every integer score in range", () => {
    for (let s = 0; s <= 100; s++) {
      const lvl = levelForScore(s);
      expect(lvl).toBeDefined();
      expect(lvl.id).toMatch(/^L[1-5]$/);
      // the returned level's band must actually contain the (rounded) score
      expect(s).toBeGreaterThanOrEqual(lvl.band[0]);
      expect(s).toBeLessThanOrEqual(lvl.band[1]);
    }
  });
});

describe("SCORING_RUBRIC_VERSION — mechanical backstop for the bump-on-change invariant", () => {
  // The version constant's doc-comment names the failure it prevents (forget to bump after a
  // score-moving edit → stale cached scores served as current fleet-wide for up to 7 days), but the
  // invariant lived entirely in that comment — no test, no CI check, tied the constant to the knobs it
  // versions. This snapshot hashes the rubric surface (dimension weights+criteria, level bands, blend,
  // guardband, posture threshold, every archetype lens, and the stable assessment SYSTEM prompt) and
  // fails when any of it moves without this pin being re-derived — at which point the failure message
  // forces the SCORING_RUBRIC_VERSION decision into the same diff. (maturity-model-scoring-engine #3)
  //
  // To update after a DELIBERATE rubric change:
  //   1. Bump SCORING_RUBRIC_VERSION in src/lib/maturity/model.ts (e.g. "r2" -> "r3").
  //   2. Re-run this test, copy the printed hash into EXPECTED_RUBRIC_HASH below.
  // Detector point-table changes (docs/features/scanning/calibration.md tuning loop step 3) also move scores and also
  // require a bump; they aren't hashable here (they live across analyze/*), so treat any calibration
  // retune as a bump trigger even though this test can't catch it.
  const rubricSurface = JSON.stringify({
    dimensions: DIMENSIONS,
    levels: LEVELS,
    scoreBlend: SCORE_BLEND,
    llmGuardband: LLM_GUARDBAND,
    postureThreshold: POSTURE_THRESHOLD,
    archetypeWeights: ARCHETYPE_WEIGHTS,
    systemPrompt: buildAssessmentPrompt({
      repo: { owner: "pin", name: "rubric", url: "", stars: 0, forks: 0, defaultBranch: "main" },
      signals: [],
      files: [],
      commitSample: [],
      archetype: "org",
    }).system,
  });
  const actual = createHash("sha256").update(rubricSurface).digest("hex");

  it(`rubric surface hash is pinned to version "${SCORING_RUBRIC_VERSION}"`, () => {
    const EXPECTED_RUBRIC_HASH = "81f6d771307fbfe5341290c1a2288b1dc9ca8a0ed6310abd324a3458dbc78017";
    expect(
      actual,
      `The scoring rubric changed (weights/bands/blend/guardband/posture threshold/lens/prompt). ` +
        `Bump SCORING_RUBRIC_VERSION (currently "${SCORING_RUBRIC_VERSION}") in src/lib/maturity/model.ts ` +
        `so cached scores re-derive under the new rubric, then update EXPECTED_RUBRIC_HASH to "${actual}".`,
    ).toBe(EXPECTED_RUBRIC_HASH);
  });
});

describe("LEVELS rubric shape — the bands these tests pin", () => {
  it("has 5 contiguous, gap-free, non-overlapping bands covering 0..100", () => {
    const byId = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
    expect(byId.L1.band).toEqual([0, 24]);
    expect(byId.L2.band).toEqual([25, 44]);
    expect(byId.L3.band).toEqual([45, 64]);
    expect(byId.L4.band).toEqual([65, 84]);
    expect(byId.L5.band).toEqual([85, 100]);

    // contiguity: each band's lower edge is exactly one past the previous upper edge
    const ordered = ["L1", "L2", "L3", "L4", "L5"].map((id) => byId[id]);
    expect(ordered[0].band[0]).toBe(0);
    expect(ordered[ordered.length - 1].band[1]).toBe(100);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].band[0]).toBe(ordered[i - 1].band[1] + 1);
    }
  });
});

describe("POSTURE_META — canonical posture taxonomy shape", () => {
  it("every posture carries a non-empty short label (charts derive from it, never re-type)", async () => {
    const { POSTURE_META } = await import("@/lib/maturity/model");
    expect(POSTURE_META).toHaveLength(4);
    for (const p of POSTURE_META) {
      expect(p.short.length).toBeGreaterThan(0);
      // Short forms are Title Case abbreviations of the full label — pin the casing so the
      // quadrant can't regress to the drifted "Getting started" hand-copy it once shipped.
      expect(p.short[0]).toBe(p.short[0]!.toUpperCase());
    }
    const short = Object.fromEntries(POSTURE_META.map((p) => [p.id, p.short]));
    expect(short).toEqual({
      "ai-native": "AI-Native",
      ungoverned: "Ungoverned",
      manual: "Manual",
      early: "Getting Started",
    });
  });
});

// A dimension with NO configured lens weight (`undefined` — future rubric drift, e.g. a new
// dimension added to DIMENSIONS without updating every ARCHETYPE_WEIGHTS lens) must be distinguished
// from one legitimately weighted at 0: both fall back to 0 in the sum (a dropped dimension can't
// silently deflate the score), but only the MISSING case should warn (G3-05). "D10" stands in for a
// future/drifted id that isn't in any current ARCHETYPE_WEIGHTS lens.
describe("lens weight: missing vs. genuinely-zero (G3-05)", () => {
  const DRIFTED_ID = "D10" as DimensionId;

  it("overallScoreFor warns when a scored dimension has no configured lens weight", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    overallScoreFor([{ id: "D1", score: 80 }, { id: DRIFTED_ID, score: 80 }], "org");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`no lens weight configured for dimension "D10"`));
    warnSpy.mockRestore();
  });

  it("overallScoreFor does not warn when every scored dimension has a real (possibly small) weight", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    overallScoreFor(DIMENSIONS.map((d) => ({ id: d.id, score: 80 })), "org");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("a missing weight is excluded from the renormalized mean exactly like a genuine 0 would be", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const withDrift = overallScoreFor([{ id: "D1", score: 80 }, { id: DRIFTED_ID, score: 0 }], "org");
    const withoutDrift = overallScoreFor([{ id: "D1", score: 80 }], "org");
    expect(withDrift).toBe(withoutDrift); // renormalizes over D1 alone either way
    warnSpy.mockRestore();
  });

  it("axisScore and axisMeasured warn the same way when a REAL dimension's lens entry goes missing (e.g. a lens edited without updating every id)", () => {
    // D1 is on the "adoption" axis and always configured — delete it from the org lens to simulate
    // the drift this fix targets, then restore it so no other test observes the mutation.
    const saved = ARCHETYPE_WEIGHTS.org.D1;
    delete (ARCHETYPE_WEIGHTS.org as Partial<Record<DimensionId, number>>).D1;
    try {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      axisScore("adoption", () => 80, "org");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`"D1"`));
      warnSpy.mockClear();
      axisMeasured("adoption", "org");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`"D1"`));
      warnSpy.mockRestore();
    } finally {
      ARCHETYPE_WEIGHTS.org.D1 = saved;
    }
  });
});
