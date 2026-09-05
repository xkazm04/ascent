// THE MATRIX'S ECONOMICS HALF (UAT `PRIYA-L1-704`) — a sibling file rather than more of
// `outcomeMatrix.test.ts`, which is at the 200-line cap.
//
// `getLoopRunDetail` has shipped `economics: LaneEconomics[]` to the browser on every detail read
// since the remediation ledger landed, and `grep -rn "\.economics" src/features src/app` returned
// zero hits: the wave-2 refactor deleted the panel the spec named and its replacement carried no cost
// figure at all. What is pinned here is that a lane's spend reaches ITS OWN cell — charging one
// repo's cell for another repo's lane is precisely the error the org-wide average already makes.

import { describe, expect, it } from "vitest";
import type { LaneEconomics, LoopLaneOutcome, LoopLaneRecord, LoopRunDetail } from "../cockpit/loopTypes";
import { buildOutcomeMatrix } from "./outcomeMatrix";

const lane = (o: Partial<LoopLaneRecord>): LoopLaneRecord => ({
  id: "l", runId: "r", repoFullName: "acme/one", cycle: 1, phase: "done", branch: null, batchIds: [], closedIds: [],
  commits: 1, beforeScanId: null, afterScanId: null, stage: null, log: [], error: null, startedAt: null, endedAt: null, deliverables: [], ...o,
});

// No scans and no diff: the economics fold is independent of the attribution fold, and a fixture that
// dragged a scan pair in would be pinning the wrong thing.
const outcome = (l: LoopLaneRecord): LoopLaneOutcome => ({
  kind: "backlog", before: null, after: null, diff: null, closedFollowUpIds: [], commits: 1, deliverables: [], lane: l,
});

const detail = (id: string, outcomes: LoopLaneOutcome[], economics: LaneEconomics[]): LoopRunDetail => ({
  run: {
    id, orgId: "o", createdBy: null, phase: "done", repos: outcomes.map((o) => o.lane.repoFullName), targets: [], concurrency: 2,
    maxCycles: 3, cycle: 1, curated: true, model: "sonnet", effort: null, startedAt: "2026-08-26T10:00:00Z", endedAt: null,
    error: null, createdAt: "2026-08-26T10:00:00Z",
  },
  lanes: outcomes.map((o) => o.lane),
  outcomes,
  economics,
  itemOutcomes: [],
});

const econ = (laneId: string, costMicros: number | null, verifiedPoints: number | null): LaneEconomics => ({
  laneId, repo: "acme/one", model: "sonnet", costMicros, verifiedPoints, microsPerVerifiedPoint: null, byDim: [], unproductive: false,
});

describe("per-cell economics", () => {
  it("folds each lane's economics into the cell for ITS repo, and no other", () => {
    const m = buildOutcomeMatrix([
      detail(
        "r-e",
        [outcome(lane({ id: "le1", runId: "r-e", repoFullName: "acme/one" })), outcome(lane({ id: "le2", runId: "r-e", repoFullName: "acme/two" }))],
        [econ("le1", 3_000_000, 2), econ("le2", 1_019_000_000, 0)],
      ),
    ]);
    const one = m.groups.find((g) => g.repo === "acme/one")!.cells["r-e"]!;
    const two = m.groups.find((g) => g.repo === "acme/two")!.cells["r-e"]!;
    expect(one.economics).toMatchObject({ costMicros: 3_000_000, verifiedPoints: 2, microsPerVerifiedPoint: 1_500_000, lanes: 1 });
    // The $10.19-for-0-points lane: counted, never hidden, and never divided.
    expect(two.economics).toMatchObject({ costMicros: 1_019_000_000, verifiedPoints: 0, unproductive: true, microsPerVerifiedPoint: null });
  });

  it("leaves a cell's economics null when the payload carried none — never a zero", () => {
    const m = buildOutcomeMatrix([detail("r-none", [outcome(lane({ id: "ln", runId: "r-none" }))], [])]);
    expect(m.groups[0]!.cells["r-none"]!.economics).toBeNull();
  });

  // A payload from a deployment older than the ledger has no `economics` key at all. The fold must
  // not throw on the way to rendering nothing.
  it("survives a payload with no `economics` key", () => {
    const d = detail("r-old", [outcome(lane({ id: "lo", runId: "r-old" }))], []) as Partial<LoopRunDetail>;
    delete d.economics;
    expect(buildOutcomeMatrix([d as LoopRunDetail]).groups[0]!.cells["r-old"]!.economics).toBeNull();
  });
});
