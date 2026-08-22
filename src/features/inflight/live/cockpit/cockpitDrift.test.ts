// Where the field's drift gets its two ends. The rule under test is that BOTH come from the run's
// own bracketing scan pair — so a run the browser never watched drifts identically to one it did —
// and that a repo the run did not touch is byte-identical on both sides (it must not move).

import { describe, expect, it } from "vitest";
import { driftFor, runLift, scanningRepos } from "./cockpitDrift";
import type { ObservatorySeed } from "../observatory";
import type { LoopLaneOutcome, LoopLaneRecord, LoopRunDetail } from "./loopTypes";

const seed = (fullName: string, adoption: number, rigor: number): ObservatorySeed => ({
  fullName,
  name: fullName.split("/")[1]!,
  overall: Math.round((adoption + rigor) / 2),
  adoption,
  rigor,
  level: "L3",
  posture: "manual",
});

const end = (overall: number, adoption: number, rigor: number) => ({
  id: `s-${overall}`,
  scannedAt: "2026-08-22T10:00:00.000Z",
  overallScore: overall,
  adoptionScore: adoption,
  rigorScore: rigor,
  level: "L3",
  levelName: "Augmented",
  archetype: "org" as const,
  posture: "manual",
  confidence: 0.8,
  engineProvider: "mock",
  headSha: null,
  dimensions: [],
  recommendations: [],
});

const lane = (repo: string, o: Partial<LoopLaneRecord> = {}): LoopLaneRecord => ({
  id: `lane-${repo}`,
  runId: "run-1",
  repoFullName: repo,
  cycle: 1,
  phase: "done",
  branch: null,
  batchIds: [],
  closedIds: [],
  commits: 1,
  beforeScanId: "b",
  afterScanId: "a",
  stage: null,
  log: [],
  error: null,
  startedAt: null,
  endedAt: null,
  ...o,
});

const detail = (outcomes: LoopLaneOutcome[]): LoopRunDetail => ({
  run: {
    id: "run-1",
    orgId: "o",
    createdBy: null,
    phase: "done",
    repos: outcomes.map((o) => o.lane.repoFullName),
    concurrency: 2,
    maxCycles: 3,
    cycle: 1,
    curated: false,
    startedAt: "2026-08-22T10:00:00Z",
    endedAt: "2026-08-22T10:30:00Z",
    error: null,
    createdAt: "2026-08-22T10:00:00Z",
  },
  lanes: outcomes.map((o) => o.lane),
  outcomes,
});

const worked: LoopLaneOutcome = {
  lane: lane("acme/one"),
  before: end(40, 30, 50),
  after: end(62, 60, 64),
  diff: null,
  closedFollowUpIds: [],
  commits: 3,
};

const seeds = [seed("acme/one", 60, 64), seed("acme/two", 20, 20)];

describe("driftFor", () => {
  it("moves the worked repo from its BEFORE scan to its AFTER scan", () => {
    const d = driftFor(seeds, [], detail([worked]))!;
    const beforeOne = d.before.find((b) => b.fullName === "acme/one")!;
    const afterOne = d.after.find((b) => b.fullName === "acme/one")!;
    expect([beforeOne.x, beforeOne.y]).toEqual([30, 50]);
    expect([afterOne.x, afterOne.y]).toEqual([60, 64]);
    expect(beforeOne.quadrant).toBe("rigor-heavy");
    expect(afterOne.quadrant).toBe("compounding");
  });

  it("leaves an untouched repo identical on both sides", () => {
    const d = driftFor(seeds, [], detail([worked]))!;
    expect(d.before.find((b) => b.fullName === "acme/two")).toEqual(d.after.find((b) => b.fullName === "acme/two"));
  });

  it("refuses a drift when no lane has both ends", () => {
    expect(driftFor(seeds, [], detail([{ ...worked, before: null }]))).toBeNull();
    expect(driftFor(seeds, [], detail([]))).toBeNull();
  });

  it("keys each replay distinctly so the field plays it again", () => {
    expect(driftFor(seeds, [], detail([worked]), 0)!.runId).toBe("run-1:0");
    expect(driftFor(seeds, [], detail([worked]), 2)!.runId).toBe("run-1:2");
  });
});

describe("scanningRepos", () => {
  it("pulses both working phases, and nothing else", () => {
    const d = detail([
      { ...worked, lane: lane("acme/one", { phase: "dispatching" }) },
      { ...worked, lane: lane("acme/two", { phase: "rescanning" }) },
      { ...worked, lane: lane("acme/three", { phase: "queued" }) },
      { ...worked, lane: lane("acme/four", { phase: "done" }) },
    ]);
    expect([...scanningRepos(d)].sort()).toEqual(["acme/one", "acme/two"]);
    expect(scanningRepos(null).size).toBe(0);
  });
});

describe("runLift", () => {
  it("sums only the lanes that have both ends, and is null when none do", () => {
    expect(runLift(detail([worked, { ...worked, lane: lane("acme/two"), before: null }]))).toBe(22);
    expect(runLift(detail([{ ...worked, after: null }]))).toBeNull();
  });
});
