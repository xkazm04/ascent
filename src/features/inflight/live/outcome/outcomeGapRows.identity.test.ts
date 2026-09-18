// ONE GAP = ONE SHEET ROW ACROSS RESCANS.
//
// A `Recommendation` row is recreated on every scan — scan-persist carries its status by (dimension,
// normalized title) onto a NEW id. So the same gap worked in two runs with a rescan between reaches
// the sheet under two different ids, and a row keyed on the id split it in two: two rows for one
// gap, each claiming half its history. These pin the durable key end to end — gap rows, the sheet's
// row axis, and the Proposals ledger that shares `gapKey`.

import { describe, expect, it } from "vitest";
import { diffScans } from "@/lib/report/compare";
import { DIMENSIONS } from "@/lib/maturity/model";
import type { ComparableScan } from "@/lib/db/scans";
import { pendingLoopProposals } from "@/features/inflight/proposals/proposalsModel";
import type { LoopLaneOutcome, LoopLaneRecord, LoopRunDetail } from "../cockpit/loopTypes";
import { buildGapRows, gapKey } from "./outcomeGapRows";
import { buildOutcomeMatrix } from "./outcomeMatrix";
import { buildSheetProjects } from "./outcomeSheetModel";

const scan = (id: string, recs: { id: string; title: string; status?: string; dimId?: string }[], overallScore = 50): ComparableScan => ({
  id, scannedAt: "2026-08-22T10:00:00.000Z", overallScore, level: "L3", levelName: "Augmented", archetype: "org",
  adoptionScore: 50, rigorScore: 50, posture: "manual", confidence: 0.8, engineProvider: "anthropic", engineModel: "claude",
  engineDegraded: false, headSha: null,
  dimensions: DIMENSIONS.map((dm) => ({ dimId: dm.id, name: dm.name, score: 50, signalScore: 50, evidence: [], gaps: [] })),
  recommendations: recs.map((r) => ({ dimId: "D2", status: "open", ...r })),
});

const lane = (o: Partial<LoopLaneRecord> & { id: string; runId: string }): LoopLaneRecord =>
  ({ repoFullName: "acme/one", cycle: 1, phase: "done", branch: null, batchIds: [], closedIds: [], commits: 0,
    beforeScanId: null, afterScanId: null, stage: null, log: [], error: null, startedAt: null, endedAt: null, deliverables: [], ...o }) as LoopLaneRecord;

const outcome = (l: LoopLaneRecord, before: ComparableScan | null, after: ComparableScan | null, o: Partial<LoopLaneOutcome> = {}): LoopLaneOutcome => ({
  kind: "backlog", lane: l, before, after, diff: before && after ? diffScans(before, after) : null, closedFollowUpIds: [],
  commits: l.commits, deliverables: [], ...o,
});

const detail = (id: string, startedAt: string, outcomes: LoopLaneOutcome[]): LoopRunDetail =>
  ({ run: { id, orgId: "o", createdBy: null, phase: "done", repos: ["acme/one"], targets: [], concurrency: 2, maxCycles: 3, cycle: 1,
    curated: false, model: null, effort: null, startedAt, endedAt: startedAt, error: null, createdAt: startedAt },
  lanes: outcomes.map((o) => o.lane), outcomes, itemOutcomes: [] }) as unknown as LoopRunDetail;

// Scan 1 raises the gap as rec-1. Run 1 works it; the rescan (scan 2) still raises it — carried onto
// a NEW id, rec-11, and rephrased by a full stop. Run 2 arms rec-11 and leaves it proposed.
const s1 = scan("s1", [{ id: "rec-1", title: "Add a coverage gate to CI" }, { id: "rec-2", title: "Write CONTRIBUTING.md" }], 40);
const s2 = scan("s2", [{ id: "rec-11", title: "Add a coverage gate to CI." }, { id: "rec-12", title: "Write CONTRIBUTING.md" }], 41);
const claim = { headline: "Added a coverage gate to CI", dimId: "D2" as const, kind: "closed" as const, covers: ["rec-1"], evidence: null };

const run1 = detail("run-1", "2026-09-01T10:00:00Z", [
  outcome(lane({ id: "l1", runId: "run-1", batchIds: ["rec-1"], commits: 2 }), s1, s2, { deliverables: [claim] }),
]);
const run2 = detail("run-2", "2026-09-02T10:00:00Z", [outcome(lane({ id: "l2", runId: "run-2", batchIds: ["rec-11"] }), s2, null)]);

describe("gapKey — keyed on the durable identity, not the recreated id", () => {
  it("gives the same gap under two different recommendation ids ONE key", () => {
    const [a] = buildGapRows(run1.outcomes);
    const [b] = buildGapRows(run2.outcomes);
    expect(a!.covers).toEqual(["rec-1"]);
    expect(b!.covers).toEqual(["rec-11"]);
    expect(gapKey(a!)).toBe(gapKey(b!));
  });

  it("keeps two different gaps in one dimension apart", () => {
    const rows = buildGapRows([outcome(lane({ id: "l3", runId: "r", batchIds: ["rec-1", "rec-2"] }), s1, null)]);
    expect(rows).toHaveLength(2);
    expect(gapKey(rows[0]!)).not.toBe(gapKey(rows[1]!));
  });

  it("falls back to the id for an item nothing can title — two such ids stay two rows", () => {
    const dead = outcome(lane({ id: "l4", runId: "r", batchIds: ["rec-x", "rec-y"] }), null, null);
    const rows = buildGapRows([dead]);
    expect(rows.map((r) => r.identity)).toEqual([undefined, undefined]);
    expect(rows.map(gapKey)).toEqual(["id|rec-x", "id|rec-y"]);
  });

  it("titles a dead lane's item from the run's batchTitles, so it still joins its gap", () => {
    const dead = outcome(lane({ id: "l5", runId: "r", batchIds: ["rec-21"] }), null, null);
    const [row] = buildGapRows([dead], { "rec-21": { title: "add a COVERAGE gate to ci", dimId: "D2" } });
    expect(gapKey(row!)).toBe(gapKey(buildGapRows(run1.outcomes)[0]!));
  });
});

describe("one gap = one row, within a run and across runs", () => {
  it("folds a gap re-armed after a mid-run rescan (cycle 1 → cycle 2) into one row covering both ids", () => {
    const rows = buildGapRows([
      outcome(lane({ id: "c1", runId: "r", cycle: 1, batchIds: ["rec-1"] }), s1, s2),
      outcome(lane({ id: "c2", runId: "r", cycle: 2, batchIds: ["rec-11"] }), s2, null),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.covers).toEqual(["rec-1", "rec-11"]);
  });

  it("renders the same gap worked in two runs, with a rescan between, as ONE sheet row", () => {
    const [project] = buildSheetProjects(buildOutcomeMatrix([run1, run2]));
    const gate = project!.rows.filter((r) => /coverage gate/i.test(r.headline));
    expect(gate).toHaveLength(1);
    // Content in BOTH run columns — each addressed by that run's own id for its review POST.
    expect(gate[0]!.cells["run-1"]).toMatchObject({ cover: "rec-1", laneId: "l1" });
    expect(gate[0]!.cells["run-2"]).toMatchObject({ cover: "rec-11", laneId: "l2", state: "proposed" });
  });

  it("judges a gap by its LATEST appearance in the Proposals ledger, across the rescan", () => {
    // Run 1 left the gap proposed (no commits); run 2 re-proposed it under its new id. One proposal.
    const idle = detail("run-1", "2026-09-01T10:00:00Z", [outcome(lane({ id: "l1", runId: "run-1", batchIds: ["rec-1"] }), s1, s2)]);
    const pending = pendingLoopProposals([idle, run2]);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ runId: "run-2", cover: "rec-11" });
  });
});
