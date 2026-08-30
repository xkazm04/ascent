// A LANE WITH NO COMMITS CONTRIBUTES NOTHING TO THE HEADLINE (L2-B-01, 2026-08-29).
//
// The live ledger printed `▲+24 · ATTRIBUTABLE LIFT` three lines above `0 commits`, for an agent
// lane whose work was deleted with its worktree. `runLane` now refuses to rescan such a lane at all —
// but the rows written before that gate existed are still in the database and this ledger renders
// them, so the refusal has to live on the READ side too.

import { describe, expect, it } from "vitest";
import { driftFor, laneAttribution, runAttribution, runLift } from "./cockpitDrift";
import type { LoopLaneOutcome, LoopLaneRecord, LoopRunDetail } from "./loopTypes";
import type { ObservatorySeed } from "../observatory";

const end = (overall: number) => ({
  id: `s-${overall}`,
  scannedAt: "2026-08-29T11:00:00.000Z",
  overallScore: overall,
  adoptionScore: overall,
  rigorScore: overall,
  level: "L2",
  levelName: "Augmented",
  archetype: "team" as const,
  posture: "manual",
  confidence: 0.8,
  engineProvider: "claude-cli",
  engineModel: "opus",
  engineDegraded: false,
  headSha: null,
  dimensions: [],
  recommendations: [],
});

const lane = (repo: string): LoopLaneRecord => ({
  id: `lane-${repo}`,
  runId: "run-1",
  repoFullName: repo,
  cycle: 2,
  phase: "done",
  branch: "ascent/loop-20260829113408-ascent-l2-bare-svc",
  batchIds: [],
  closedIds: [],
  commits: 0,
  beforeScanId: "b",
  afterScanId: "a",
  stage: null,
  log: [],
  error: null,
  startedAt: null,
  endedAt: null,
});

/** The exact shape of the L2 run's cycle 2: a real pair, 19 → 43, and nothing committed. */
const lost: LoopLaneOutcome = {
  lane: lane("ascent-l2/bare-svc"),
  kind: "backlog",
  before: end(19),
  after: end(43),
  diff: null,
  closedFollowUpIds: [],
  commits: 0,
};

const landed: LoopLaneOutcome = { ...lost, lane: { ...lane("acme/api"), commits: 1 }, commits: 1 };

const detail = (outcomes: LoopLaneOutcome[]): LoopRunDetail => ({
  run: {
    id: "run-1",
    orgId: "o",
    createdBy: null,
    phase: "done",
    repos: outcomes.map((o) => o.lane.repoFullName),
    concurrency: 1,
    maxCycles: 2,
    cycle: 2,
    curated: false,
    startedAt: "2026-08-29T11:34:00Z",
    endedAt: "2026-08-29T11:44:31Z",
    error: null,
    createdAt: "2026-08-29T11:34:00Z",
  },
  lanes: outcomes.map((o) => o.lane),
  outcomes,
});

describe("a lane that committed nothing", () => {
  it("is refused with its own verdict, not folded into noise or 'not measured'", () => {
    const v = laneAttribution(lost);
    expect(v.kind).toBe("undelivered");
    expect(v).toMatchObject({ delta: 24 });
  });

  it("contributes nothing to the run's headline lift", () => {
    expect(runLift(detail([lost]))).toBeNull();
    const totals = runAttribution(detail([lost]));
    expect(totals).toMatchObject({ lift: null, attributable: 0, undelivered: 1, withinNoise: 0, mock: 0 });
  });

  it("does not dilute a sibling lane that DID land its work", () => {
    const totals = runAttribution(detail([lost, landed]));
    expect(totals.lift).toBe(24); // the delivered lane only
    expect(totals.attributable).toBe(1);
    expect(totals.undelivered).toBe(1);
  });

  it("does not move a body in the field either — the sky cannot outrun the ledger", () => {
    const seeds: ObservatorySeed[] = [
      { fullName: "ascent-l2/bare-svc", name: "bare-svc", overall: 43, adoption: 43, rigor: 43, level: "L2", posture: "manual" },
    ];
    expect(driftFor(seeds, [], detail([lost]))).toBeNull();
  });

  it("still measures a lane that committed — the gate is durability, not a new refusal", () => {
    expect(laneAttribution(landed).kind).toBe("attributable");
  });
});
