// The lane rail's one rule: the marker sits at a stop the SERVER actually reported, and nowhere
// else. These pin the phase→stop mapping (including the two cases that are easy to fake: a
// `rescanning` lane with no sub-stage yet, and an `error` lane, which has no position of its own).

import { describe, expect, it } from "vitest";
import { LANE_STOPS, laneActiveStop, laneCaption, laneIsLive, laneMarkerPct, laneStopIndex, type LanePosition } from "./laneStages";

const lane = (o: Partial<LanePosition>): LanePosition => ({ phase: "queued", stage: null, ...o });

describe("LANE_STOPS", () => {
  it("is queued → dispatching → the six rescan sub-stages → done, with no invented 'commits' stop", () => {
    expect(LANE_STOPS.map((s) => s.id)).toEqual([
      "queued",
      "dispatching",
      "fetch",
      "tree",
      "files",
      "analyze",
      "score",
      "compose",
      "done",
    ]);
    expect(LANE_STOPS.filter((s) => s.rescan)).toHaveLength(6);
  });
});

describe("laneStopIndex", () => {
  it("maps each lane phase to its stop", () => {
    expect(laneStopIndex(lane({ phase: "queued" }))).toBe(0);
    expect(laneStopIndex(lane({ phase: "dispatching" }))).toBe(1);
    expect(laneStopIndex(lane({ phase: "done" }))).toBe(LANE_STOPS.length - 1);
  });

  it("places a rescanning lane at its sub-stage", () => {
    expect(laneStopIndex(lane({ phase: "rescanning", stage: "fetch" }))).toBe(2);
    expect(laneStopIndex(lane({ phase: "rescanning", stage: "analyze" }))).toBe(5);
    expect(laneStopIndex(lane({ phase: "rescanning", stage: "compose" }))).toBe(7);
  });

  it("parks a rescanning lane with no sub-stage yet at the HEAD of the rescan bracket", () => {
    // Not at `analyze`, and not still at `dispatching` — the lane really has moved on.
    expect(laneStopIndex(lane({ phase: "rescanning", stage: null }))).toBe(2);
  });

  it("ignores a sub-stage the scanner does not emit", () => {
    expect(laneStopIndex(lane({ phase: "rescanning", stage: "nonsense" }))).toBe(2);
  });

  it("keeps an errored lane at the last stop it is KNOWN to have reached", () => {
    expect(laneStopIndex(lane({ phase: "error", stage: "score" }))).toBe(6);
    expect(laneStopIndex(lane({ phase: "error", stage: null, startedAt: "2026-08-22T10:00:00Z" }))).toBe(1);
    expect(laneStopIndex(lane({ phase: "error", stage: null }))).toBe(0);
  });
});

describe("laneMarkerPct", () => {
  it("spans 0 → 100 across the rail", () => {
    expect(laneMarkerPct(lane({ phase: "queued" }))).toBe(0);
    expect(laneMarkerPct(lane({ phase: "done" }))).toBe(100);
  });

  it("advances monotonically through the sub-stages", () => {
    const pcts = ["fetch", "tree", "files", "analyze", "score", "compose"].map((s) =>
      laneMarkerPct(lane({ phase: "rescanning", stage: s })),
    );
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
    expect(new Set(pcts).size).toBe(6);
  });
});

describe("laneActiveStop / laneIsLive / laneCaption", () => {
  it("names the stop the marker is sitting at", () => {
    expect(laneActiveStop(lane({ phase: "rescanning", stage: "score" })).id).toBe("score");
  });

  it("treats only the two working phases as live", () => {
    expect(laneIsLive("dispatching")).toBe(true);
    expect(laneIsLive("rescanning")).toBe(true);
    expect(laneIsLive("queued")).toBe(false);
    expect(laneIsLive("done")).toBe(false);
    expect(laneIsLive("error")).toBe(false);
  });

  it("captions the rescan with its sub-stage when there is one", () => {
    expect(laneCaption(lane({ phase: "rescanning", stage: "analyze" }))).toBe("rescanning · analyzing");
    expect(laneCaption(lane({ phase: "rescanning", stage: null }))).toBe("rescanning");
    expect(laneCaption(lane({ phase: "dispatching" }))).toBe("agent working");
  });
});
