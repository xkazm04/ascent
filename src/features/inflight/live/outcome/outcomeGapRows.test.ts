// The gap-row fold: one row per gap, a state per row (committed · uncommitted · proposed), a
// proposed row synthesized for every armed batch item nothing accounts for, and review markers
// attached to the rows they key — never rendered as rows of their own.

import { describe, expect, it } from "vitest";
import { diffScans } from "@/lib/report/compare";
import { DIMENSIONS } from "@/lib/maturity/model";
import type { ComparableScan } from "@/lib/db/scans";
import type { LoopLaneOutcome, LoopLaneRecord } from "../cockpit/loopTypes";
import { buildGapRows, rowCover } from "./outcomeGapRows";

const scan = (p: Partial<ComparableScan> & { id: string }): ComparableScan => ({
  scannedAt: "2026-08-22T10:00:00.000Z", overallScore: 50, level: "L3", levelName: "Augmented", archetype: "org",
  adoptionScore: 50, rigorScore: 50, posture: "manual", confidence: 0.8, engineProvider: "anthropic", engineModel: "claude",
  engineDegraded: false, headSha: null,
  dimensions: DIMENSIONS.map((dm) => ({ dimId: dm.id, name: dm.name, score: 50, signalScore: 50, evidence: [], gaps: [] })),
  recommendations: [], ...p,
});

const rec = (id: string, title: string, status = "open") => ({ id, title, dimId: "D2", status });
const before = scan({ id: "b", overallScore: 40, recommendations: [rec("rec-1", "Add a coverage gate to CI"), rec("rec-2", "Write CONTRIBUTING.md")] });
const after = scan({ id: "a", overallScore: 52, recommendations: [rec("rec-1", "Add a coverage gate to CI", "done"), rec("rec-2", "Write CONTRIBUTING.md")] });

const lane = (o: Partial<LoopLaneRecord>): LoopLaneRecord => ({
  id: "l1", runId: "r", repoFullName: "acme/one", cycle: 1, phase: "done", branch: null, batchIds: [], closedIds: [],
  commits: 2, beforeScanId: "b", afterScanId: "a", stage: null, log: [], error: null, startedAt: null, endedAt: null, deliverables: [],
  model: null, costSource: null, costMicros: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, turns: null,
  agentDurationMs: null, agentSessionId: null, abPairKey: null, dimId: null, prNumber: null, prUrl: null, brief: null, report: null, ...o,
});

const closedRow = { headline: "Added a coverage gate to CI", dimId: "D2" as const, kind: "closed" as const, covers: ["rec-1"], evidence: null };

const outcome = (o: Partial<LoopLaneOutcome> & { lane: LoopLaneRecord }): LoopLaneOutcome => ({
  kind: "backlog", before, after, diff: diffScans(before, after), closedFollowUpIds: [], commits: o.lane.commits,
  deliverables: [], ...o,
});

describe("buildGapRows — one state per row", () => {
  it("marks a claim covered by commits and an attributable pair `committed`", () => {
    const rows = buildGapRows([outcome({ lane: lane({}), deliverables: [closedRow] })]);
    expect(rows).toEqual([{ ...closedRow, state: "committed", laneId: "l1" }]);
  });

  it("marks a claim `committed` on its closed id even when the pair's movement was refused", () => {
    const noisy = scan({ id: "an", overallScore: 41 }); // within the ±2 band
    const rows = buildGapRows([
      outcome({ lane: lane({}), after: noisy, diff: diffScans(before, noisy), closedFollowUpIds: ["rec-1"], deliverables: [closedRow] }),
    ]);
    expect(rows[0]!.state).toBe("committed");
  });

  it("marks a RESOLVED claim with no commits behind it `uncommitted` — the lost-deliverable case", () => {
    const rows = buildGapRows([outcome({ lane: lane({ commits: 0 }), deliverables: [closedRow] })]);
    expect(rows[0]!.state).toBe("uncommitted");
  });

  it("synthesizes a `proposed` row, titled from the follow-up, for an armed batch item nothing resolved", () => {
    const rows = buildGapRows([outcome({ lane: lane({ batchIds: ["rec-1", "rec-2"] }), deliverables: [closedRow] })]);
    expect(rows).toHaveLength(2);
    const proposed = rows.find((r) => r.covers[0] === "rec-2")!;
    expect(proposed).toMatchObject({ headline: "Write CONTRIBUTING.md", kind: "noted", state: "proposed", laneId: "l1" });
    expect(rowCover(proposed)).toBe("rec-2");
  });

  it("attaches a review marker's ruling to the row it keys, and never renders the marker itself", () => {
    const marker = { headline: "rec-2", dimId: null, kind: "noted" as const, covers: ["rec-2"], evidence: null, review: "dismissed" as const };
    const rows = buildGapRows([
      outcome({ lane: lane({ batchIds: ["rec-2"] }), deliverables: [{ ...closedRow, review: "approved" }, marker] }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.covers[0] === "rec-1")!.review).toBe("approved");
    expect(rows.find((r) => r.covers[0] === "rec-2")).toMatchObject({ headline: "Write CONTRIBUTING.md", review: "dismissed" });
  });

  it("dedupes only a TRUE duplicate (the same covered id across cycles), keeping same-headline gaps apart", () => {
    const cycle2 = outcome({ lane: lane({ id: "l2", cycle: 2 }), deliverables: [closedRow, { ...closedRow, covers: ["rec-2"] }] });
    const rows = buildGapRows([outcome({ lane: lane({}), deliverables: [closedRow] }), cycle2]);
    expect(rows.map((r) => r.covers)).toEqual([["rec-1"], ["rec-2"]]);
  });
});
