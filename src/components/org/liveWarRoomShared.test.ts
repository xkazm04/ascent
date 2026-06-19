import { describe, it, expect } from "vitest";
import { classifyRepoEvent, postureBarPct } from "./liveWarRoomShared";

// The server contract (POST /api/org/scan) emits three `repo` shapes:
//   { repo, error }                            — the scan threw
//   { repo, skipped: "insufficient_credits" }  — credit reservation lost, no score produced
//   { repo, level, overall, posture, adoption, rigor } — scored
// The classifier is the consumers' single trust boundary: anything else is "invalid" and must
// never reach the scored fold (the NaN-tile bug was a skip falling through to Number(undefined)).

describe("classifyRepoEvent", () => {
  it("classifies a per-repo failure as error", () => {
    expect(classifyRepoEvent({ repo: "acme/api", error: "scan failed" })).toEqual({
      kind: "error",
      message: "scan failed",
    });
  });

  it("classifies a credit-skipped repo as skipped, NOT as scored-NaN", () => {
    expect(classifyRepoEvent({ repo: "acme/api", skipped: "insufficient_credits" })).toEqual({
      kind: "skipped",
      reason: "insufficient_credits",
    });
  });

  it("classifies a full scored payload with finite numbers", () => {
    expect(
      classifyRepoEvent({ repo: "acme/api", level: "L3", overall: 62, posture: "manual", adoption: 55, rigor: 70 }),
    ).toEqual({ kind: "scored", overall: 62, adoption: 55, rigor: 70, level: "L3", posture: "manual" });
  });

  it("error takes precedence over any score fields", () => {
    expect(classifyRepoEvent({ repo: "acme/api", error: "boom", overall: 62 })).toEqual({
      kind: "error",
      message: "boom",
    });
  });

  it("rejects a payload with a missing overall as invalid (the old NaN fold)", () => {
    expect(classifyRepoEvent({ repo: "acme/api" })).toEqual({ kind: "invalid" });
  });

  it("rejects a non-finite overall as invalid", () => {
    expect(classifyRepoEvent({ repo: "acme/api", overall: "not-a-number" })).toEqual({ kind: "invalid" });
    expect(classifyRepoEvent({ repo: "acme/api", overall: Infinity })).toEqual({ kind: "invalid" });
  });

  it("nulls non-finite secondary axes instead of folding NaN", () => {
    expect(classifyRepoEvent({ repo: "acme/api", overall: 40 })).toEqual({
      kind: "scored",
      overall: 40,
      adoption: null,
      rigor: null,
      level: null,
      posture: null,
    });
  });

  it("accepts a genuinely-zero overall (absent ≠ zero, but zero is a measurement)", () => {
    const ev = classifyRepoEvent({ repo: "acme/api", overall: 0, adoption: 0, rigor: 0 });
    expect(ev).toMatchObject({ kind: "scored", overall: 0, adoption: 0, rigor: 0 });
  });
});

// The PostureMix bars must show each posture's TRUE share of the whole scored fleet (count/total*100),
// summing to ~100% — NOT max-normalized, where the leading bucket always renders as a full 100% bar and
// overstates the dominant posture's prevalence on the projected war-room wall (the regression this pins).
describe("postureBarPct", () => {
  it("bars each posture as its true fraction of the fleet, NOT normalized to the leader", () => {
    const counts = { "ai-native": 1, manual: 1 };
    // Even split → 50/50, NOT 100/100. A max-normalized regression would make both 100.
    expect(postureBarPct(1, 2, counts)).toBe(50);
    // The two real bars sum to ~100% (true distribution), not 200%.
    expect(postureBarPct(counts["ai-native"], 2, counts) + postureBarPct(counts.manual, 2, counts)).toBe(100);
  });

  it("does NOT pin the leading bucket to 100 — a skewed fleet keeps its true share", () => {
    const counts = { "ai-native": 3, manual: 1 };
    expect(postureBarPct(3, 4, counts)).toBe(75); // leader is 75%, not forced to 100%
    expect(postureBarPct(1, 4, counts)).toBe(25);
  });

  it("renders a single-posture fleet's bar at an honest 100% (4/4), and a 1-of-4 bucket at 25%", () => {
    const single = { "ai-native": 4 };
    expect(postureBarPct(4, 4, single)).toBe(100);
    const oneOfFour = { "ai-native": 1 };
    expect(postureBarPct(1, 4, oneOfFour)).toBe(25);
  });

  it("guards an empty fleet against divide-by-zero: all bars are 0, never NaN/Infinity", () => {
    const pct = postureBarPct(0, 0, {});
    expect(pct).toBe(0);
    expect(Number.isFinite(pct)).toBe(true);
  });

  it("clamps a count that exceeds the denominator to 100 (no over-wide bar)", () => {
    // Defensive: if counts disagree with `scored`, the bar can't exceed the track width.
    expect(postureBarPct(5, 0, { "ai-native": 5 })).toBe(100);
  });

  it("derives the denominator from max(scored, Σcounts) so a stale `scored` can't inflate shares", () => {
    // scored under-reports (2) but counts sum to 4 → denominator 4, so each unit is 25%, not 50%.
    const counts = { "ai-native": 2, manual: 2 };
    expect(postureBarPct(2, 2, counts)).toBe(50);
  });
});
