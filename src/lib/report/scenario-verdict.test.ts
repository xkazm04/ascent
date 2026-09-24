// The sandbox's projected-vs-actual verdict, in one pure place: the saved-plan bar renders it and the
// recommendation timeline note spells it. The load-bearing case is the RULER: since 2026-09-23
// attribution refuses a before/after pair scored under two rubric versions (sameRuler), and the rubric
// moved three times in two days. A projection modeled under r19 and "measured" under r21 is two numbers
// on two scales, so it must read as NOT COMPARABLE, never as "5 pts short" or "3 pts ahead".

import { describe, it, expect } from "vitest";
import { scenarioReconciliationNote, scenarioVerdict, notComparableReason } from "./scenario-verdict";

const SAME = { before: "r21", after: "r21", same: true } as const;
const CHANGED = { before: "r19", after: "r21", same: false } as const;
const UNRECORDED = { before: null, after: "r21", same: null } as const;

describe("scenarioVerdict", () => {
  it("guard: compares projected and actual when both ends share a ruler", () => {
    expect(scenarioVerdict(12, { delta: 7, ruler: SAME })).toEqual({ kind: "short", gap: 5 });
    expect(scenarioVerdict(12, { delta: 15, ruler: SAME })).toEqual({ kind: "ahead", gap: 3 });
    expect(scenarioVerdict(12, { delta: 12, ruler: SAME })).toEqual({ kind: "exact" });
  });

  it("refuses to call a rubric change a miss or a win", () => {
    // Short by 5 AND ahead by 3 would both be readable if the ruler were ignored; neither is honest.
    for (const delta of [7, 15, 12]) {
      expect(scenarioVerdict(12, { delta, ruler: CHANGED })).toEqual({
        kind: "not_comparable",
        reason: "rubric_changed",
        before: "r19",
        after: "r21",
      });
    }
  });

  it("treats an unrecorded rubric as unknown, never as the same ruler", () => {
    expect(scenarioVerdict(12, { delta: 7, ruler: UNRECORDED })).toMatchObject({
      kind: "not_comparable",
      reason: "rubric_unrecorded",
    });
  });

  it("names the rubric change in plain words", () => {
    const v = scenarioVerdict(12, { delta: 7, ruler: CHANGED });
    expect(notComparableReason(v)).toBe("the scoring rubric changed (r19 to r21)");
  });
});

describe("scenarioReconciliationNote", () => {
  const base = { author: "alice", projectedDelta: 12, baselineScannedAt: "2026-06-01T00:00:00.000Z" };
  const at = "2026-07-01T00:00:00.000Z";

  it("carries both signed deltas and the verdict when the ruler held", () => {
    const note = scenarioReconciliationNote({ ...base, actual: { delta: 7, scannedAt: at, ruler: SAME } });
    expect(note).toContain("@alice");
    expect(note).toContain("projected +12");
    expect(note).toContain("actual +7");
    expect(note).toContain("5 pts short of the model");
    expect(note).toContain("2026-06-01");
    expect(note).toContain("2026-07-01");
  });

  it("signs a modeled or measured loss instead of flooring it", () => {
    const note = scenarioReconciliationNote({
      ...base,
      projectedDelta: -2,
      actual: { delta: -4, scannedAt: at, ruler: SAME },
    });
    expect(note).toContain("projected -2");
    expect(note).toContain("actual -4");
  });

  it("labels a rubric change not comparable and prints no actual figure or gap", () => {
    const note = scenarioReconciliationNote({ ...base, actual: { delta: 7, scannedAt: at, ruler: CHANGED } });
    expect(note).toContain("not comparable");
    expect(note).toContain("r19 to r21");
    expect(note).not.toContain("actual +7");
    expect(note).not.toMatch(/short|ahead|exactly as modeled/);
  });

  it("omits the author mention for an anonymous scenario", () => {
    const note = scenarioReconciliationNote({ ...base, author: "", actual: { delta: 7, scannedAt: at, ruler: SAME } });
    expect(note).not.toContain("@");
    expect(note.startsWith("Sandbox plan")).toBe(true);
  });

  it("guard: writes no em dash into a user-read note", () => {
    const notes = [SAME, CHANGED, UNRECORDED].map((ruler) =>
      scenarioReconciliationNote({ ...base, actual: { delta: 7, scannedAt: at, ruler } }),
    );
    for (const n of notes) expect(n).not.toContain("—");
  });
});
