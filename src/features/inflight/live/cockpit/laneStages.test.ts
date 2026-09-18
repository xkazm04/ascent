// The lane rail's one rule: the marker sits at a stop the SERVER actually reported, and nowhere
// else. These pin the phase→stop mapping (including the two cases that are easy to fake: a
// `rescanning` lane with no sub-stage yet, and an `error` lane, which has no position of its own) —
// and, since the live signal, the four stops the dispatching stretch now has.

import { describe, expect, it } from "vitest";
import type { LaneActivity } from "@/lib/local/runner-types";
import { LANE_STOPS, laneActiveStop, laneCaption, laneIsLive, laneMarkerPct, laneStopIndex, type LanePosition } from "./laneStages";

const lane = (o: Partial<LanePosition>): LanePosition => ({ phase: "queued", stage: null, ...o });
const idx = (id: string) => LANE_STOPS.findIndex((s) => s.id === id);
const T0 = Date.parse("2026-09-18T10:00:00.000Z");
const iso = (dt: number) => new Date(T0 + dt).toISOString();
const ev = (kind: LaneActivity["kind"], dt: number): LaneActivity => ({ at: iso(dt), kind, path: null, tool: null, note: null });

describe("LANE_STOPS", () => {
  it("is queued → plan → baseline → agent → install → check → the six rescan sub-stages → done, with no 'commits' stop", () => {
    expect(LANE_STOPS.map((s) => s.id)).toEqual([
      "queued",
      "planning",
      "baseline",
      "dispatching",
      "installing",
      "verifying",
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
    expect(laneStopIndex(lane({ phase: "dispatching" }))).toBe(idx("dispatching"));
    expect(laneStopIndex(lane({ phase: "done" }))).toBe(LANE_STOPS.length - 1);
  });

  it("splits the dispatching stretch by the stage the lane wrote", () => {
    expect(laneStopIndex(lane({ phase: "dispatching", stage: "planning" }))).toBe(idx("planning"));
    expect(laneStopIndex(lane({ phase: "dispatching", stage: "installing" }))).toBe(idx("installing"));
    // `verifying` BEFORE any session ran is the baseline; after the editing session it is the check.
    expect(laneStopIndex(lane({ phase: "dispatching", stage: "verifying" }))).toBe(idx("baseline"));
    const edited = [ev("read", 0), ev("edit", 1_000), ev("result", 2_000)];
    expect(laneStopIndex(lane({ phase: "dispatching", stage: "verifying", activity: edited }))).toBe(idx("verifying"));
  });

  it("tells a planned lane's baseline from its result check by the sessions behind it", () => {
    const plannedOnly = [ev("read", 0), ev("search", 1_000), ev("result", 2_000)];
    const base = lane({ phase: "dispatching", stage: "verifying", activity: plannedOnly, planId: "plan-1" });
    expect(laneStopIndex(base)).toBe(idx("baseline"));
    // The same one-result tail on a lane that did NOT plan is the execution session that finished.
    expect(laneStopIndex({ ...base, planId: null })).toBe(idx("verifying"));
    // Two sessions behind it is the check, planned or not, edits or none.
    expect(laneStopIndex({ ...base, activity: [...plannedOnly, ev("read", 5_000), ev("result", 6_000)] })).toBe(idx("verifying"));
  });

  it("keeps every agent sub-phase on the one Agent stop, whatever the clock says", () => {
    const reading = lane({ phase: "dispatching", activity: [ev("read", 0)], stageAt: iso(0) });
    const editing = lane({ phase: "dispatching", activity: [ev("edit", 0)], stageAt: iso(0) });
    expect(laneStopIndex(reading)).toBe(idx("dispatching"));
    expect(laneStopIndex(editing)).toBe(idx("dispatching"));
  });

  it("places a rescanning lane at its sub-stage", () => {
    expect(laneStopIndex(lane({ phase: "rescanning", stage: "fetch" }))).toBe(idx("fetch"));
    expect(laneStopIndex(lane({ phase: "rescanning", stage: "analyze" }))).toBe(idx("analyze"));
    expect(laneStopIndex(lane({ phase: "rescanning", stage: "compose" }))).toBe(idx("compose"));
  });

  it("parks a rescanning lane with no sub-stage yet at the HEAD of the rescan bracket", () => {
    // Not at `analyze`, and not still at `dispatching` — the lane really has moved on.
    expect(laneStopIndex(lane({ phase: "rescanning", stage: null }))).toBe(idx("fetch"));
  });

  it("ignores a sub-stage the scanner does not emit", () => {
    expect(laneStopIndex(lane({ phase: "rescanning", stage: "nonsense" }))).toBe(idx("fetch"));
  });

  it("keeps an errored lane at the last stop it is KNOWN to have reached", () => {
    expect(laneStopIndex(lane({ phase: "error", stage: "score" }))).toBe(idx("score"));
    expect(laneStopIndex(lane({ phase: "error", stage: null, startedAt: "2026-08-22T10:00:00Z" }))).toBe(idx("dispatching"));
    expect(laneStopIndex(lane({ phase: "error", stage: null }))).toBe(0);
  });

  it("parks a FORCE-FAILED lane at the stop its watchdog stage names", () => {
    expect(laneStopIndex(lane({ phase: "error", stage: "plan" }))).toBe(idx("planning"));
    expect(laneStopIndex(lane({ phase: "error", stage: "baseline" }))).toBe(idx("baseline"));
    expect(laneStopIndex(lane({ phase: "error", stage: "agent" }))).toBe(idx("dispatching"));
    expect(laneStopIndex(lane({ phase: "error", stage: "deps" }))).toBe(idx("installing"));
    expect(laneStopIndex(lane({ phase: "error", stage: "verify" }))).toBe(idx("verifying"));
    expect(laneStopIndex(lane({ phase: "error", stage: "rescan" }))).toBe(idx("fetch"));
  });
});

describe("laneMarkerPct", () => {
  it("spans 0 → 100 across the rail", () => {
    expect(laneMarkerPct(lane({ phase: "queued" }))).toBe(0);
    expect(laneMarkerPct(lane({ phase: "done" }))).toBe(100);
  });

  it("advances monotonically through a whole planned cycle", () => {
    const planned = [ev("read", 0), ev("result", 1_000)];
    const worked = [...planned, ev("edit", 5_000), ev("result", 6_000)];
    const cycle: LanePosition[] = [
      lane({ phase: "queued" }),
      lane({ phase: "dispatching", stage: "planning", planId: null }),
      lane({ phase: "dispatching", stage: "verifying", activity: planned, planId: "p" }),
      lane({ phase: "dispatching", stage: null, activity: [...planned, ev("read", 4_000)], planId: "p" }),
      lane({ phase: "dispatching", stage: "installing", activity: worked, planId: "p" }),
      lane({ phase: "dispatching", stage: "verifying", activity: worked, planId: "p" }),
      ...["fetch", "tree", "files", "analyze", "score", "compose"].map((s) => lane({ phase: "rescanning", stage: s })),
      lane({ phase: "done" }),
    ];
    const pcts = cycle.map((l) => laneMarkerPct(l));
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
    expect(new Set(pcts).size).toBe(LANE_STOPS.length);
  });
});

describe("laneActiveStop / laneIsLive / laneCaption", () => {
  it("names the stop the marker is sitting at", () => {
    expect(laneActiveStop(lane({ phase: "rescanning", stage: "score" })).id).toBe("score");
    expect(laneActiveStop(lane({ phase: "dispatching", stage: "planning" })).id).toBe("planning");
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
  });

  it("keeps 'agent working' for a lane that carries no live signal — old rows, remote lanes, outcome cells", () => {
    expect(laneCaption(lane({ phase: "dispatching" }))).toBe("agent working");
    const remote = lane({ phase: "dispatching", executor: "remote-agent", stageAt: iso(0) });
    expect(laneCaption(remote, T0 + 1_000)).toBe("agent working");
  });

  it("captions the dispatching stretch from the one phase vocabulary", () => {
    const now = T0 + 10_000;
    expect(laneCaption(lane({ phase: "dispatching", stage: "planning" }), now)).toBe("planning");
    expect(laneCaption(lane({ phase: "dispatching", stage: "verifying" }), now)).toBe("checking the baseline");
    expect(laneCaption(lane({ phase: "dispatching", activity: [ev("read", 9_000)], stageAt: iso(0) }), now)).toBe(
      "reading the code",
    );
    expect(laneCaption(lane({ phase: "dispatching", activity: [ev("edit", 9_000)], stageAt: iso(0) }), now)).toBe("editing");
  });

  it("decays to 'still working — quiet' over a silent stream, and says for how long", () => {
    const silent = lane({ phase: "dispatching", activity: [ev("edit", 0)], stageAt: iso(0) });
    expect(laneCaption(silent, T0 + 3 * 60_000)).toBe("still working — quiet for 3m");
    // The marker does not move for it: quiet is a caption, not a position.
    expect(laneStopIndex(silent)).toBe(idx("dispatching"));
  });

  it("names the stage a FORCE-FAILED lane was cut in, and stays plain for every other error", () => {
    // The watchdog's stages (lane-watchdog.ts) are the only non-substage values `stage` can hold on a
    // terminal lane, and they are exactly the fact a silent gap used to cost.
    expect(laneCaption(lane({ phase: "error", stage: "verify" }))).toBe("error · verify");
    expect(laneCaption(lane({ phase: "error", stage: null }))).toBe("error");
    // A rescan sub-stage is already the marker's position; repeating it in the caption would say the
    // same thing twice.
    expect(laneCaption(lane({ phase: "error", stage: "score" }))).toBe("error");
  });
});
