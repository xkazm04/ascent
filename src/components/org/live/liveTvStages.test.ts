// The Dynamic-UI TV mode shows one lifecycle-relevant panel at a time; computeTvStages is the rule
// for which panels are relevant. These lock the contract: a running scan takes over alone, the
// resting view is always present, and optional stages appear only when they have something to show.

import { describe, expect, it } from "vitest";
import { clampStageIndex, computeTvStages } from "@/components/org/live/liveTvStages";

describe("computeTvStages", () => {
  it("a running scan takes the whole wall alone — no rotation away from a live event", () => {
    expect(computeTvStages({ running: true, triage: 5, inFlight: 3 })).toEqual(["scanning"]);
  });

  it("idle with nothing pending shows only the resting standing view", () => {
    expect(computeTvStages({ running: false, triage: 0, inFlight: 0 })).toEqual(["standing"]);
  });

  it("surfaces pending decisions FIRST, before standing", () => {
    expect(computeTvStages({ running: false, triage: 4, inFlight: 0 })).toEqual(["decide", "standing"]);
  });

  it("appends in-flight only when PRs are actually being watched", () => {
    expect(computeTvStages({ running: false, triage: 0, inFlight: 2 })).toEqual(["standing", "inflight"]);
    expect(computeTvStages({ running: false, triage: 3, inFlight: 2 })).toEqual(["decide", "standing", "inflight"]);
  });

  it("never returns an empty list — standing is the floor", () => {
    expect(computeTvStages({ running: false, triage: 0, inFlight: 0 }).length).toBeGreaterThan(0);
  });
});

describe("clampStageIndex", () => {
  it("wraps forward past the end", () => {
    expect(clampStageIndex(3, 3)).toBe(0);
    expect(clampStageIndex(4, 3)).toBe(1);
  });

  it("wraps a negative index (prev from the first stage)", () => {
    expect(clampStageIndex(-1, 3)).toBe(2);
  });

  it("guards an empty list against modulo-by-zero", () => {
    expect(clampStageIndex(2, 0)).toBe(0);
  });
});
