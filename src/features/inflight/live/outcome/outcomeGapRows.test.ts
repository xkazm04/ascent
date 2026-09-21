// The gap-row fold: one row per gap, a state per row (committed · uncommitted · proposed), a
// proposed row synthesized for every armed batch item nothing accounts for, and review markers
// attached to the rows they key — never rendered as rows of their own.

import { describe, expect, it } from "vitest";
import { diffScans } from "@/lib/report/compare";
import { DIMENSIONS } from "@/lib/maturity/model";
import type { ComparableScan } from "@/lib/db/scans";
import type { LoopLaneOutcome, LoopLaneRecord } from "../cockpit/loopTypes";
import { rowMeta } from "./outcomeDeliverables";
import { buildGapRows, rowCover, untitledBatchItem } from "./outcomeGapRows";

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
    // `identity` is the covered follow-up's durable key (dimension + normalized title) — see
    // outcomeGapRows.identity.test.ts for why the id alone is not one.
    expect(rows).toEqual([{ ...closedRow, state: "committed", laneId: "l1", identity: "rec|D2|add a coverage gate to ci" }]);
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

// A LANE THAT NEVER RESCANNED IS THE CASE THAT PRODUCED UUIDs IN THE LEDGER. A FORCE-FAILED or still-
// queued lane has no `after` and often no `before`, so the scan lookup that titles an armed item has
// nothing to look in — and the row used to fall back to printing the raw id, in the sheet's frozen
// column and again in the Proposals ledger. Four sources are asked now, and the last resort is a
// label rather than an id.
describe("buildGapRows — an armed item's title, when the lane has no scans", () => {
  const dead = (batchIds: string[]) =>
    outcome({ lane: lane({ batchIds, phase: "error", commits: 0, beforeScanId: null, afterScanId: null }), before: null, after: null, diff: null });

  it("falls back to the run's server-side title resolution", () => {
    const rows = buildGapRows([dead(["rec-9"])], { "rec-9": { title: "Pin the CI action SHAs", dimId: "D3" } });
    expect(rows[0]).toMatchObject({ headline: "Pin the CI action SHAs", dimId: "D3", state: "proposed" });
  });

  it("drops a dimension the client cannot render rather than carrying a raw column value", () => {
    const rows = buildGapRows([dead(["rec-9"])], { "rec-9": { title: "Something", dimId: "not-a-dimension" } });
    expect(rows[0]!.dimId).toBeNull();
  });

  it("titles from the lane's own deliverables when the run carries no resolution", () => {
    const withHeadline = outcome({
      lane: lane({ batchIds: ["rec-7"], beforeScanId: null, afterScanId: null }),
      before: null,
      after: null,
      diff: null,
      deliverables: [{ headline: "Replace the ad-hoc retry loop", dimId: null, kind: "noted", covers: ["rec-7"], evidence: null, review: "dismissed" }],
    });
    // The deliverable above is a REVIEW MARKER by shape only when its headline IS the cover; here it
    // is a real noted row, so it both renders and lends its headline to the armed id.
    expect(buildGapRows([withHeadline]).some((r) => r.headline === "Replace the ad-hoc retry loop")).toBe(true);
  });

  it("NEVER prints a bare uuid — an id nothing can title says what it is and keeps a short handle", () => {
    const id = "4f2c0b18-9a51-4a0e-8e0f-2b7c1d3e5a90";
    const rows = buildGapRows([dead([id])]);
    expect(rows[0]!.headline).toBe(untitledBatchItem(id));
    expect(rows[0]!.headline).not.toBe(id);
    expect(rows[0]!.headline).toContain("4f2c0b18");
    // The row is still addressable: the review POST keys on the id, which stays in `covers`.
    expect(rowCover(rows[0]!)).toBe(id);
  });
});

describe("buildGapRows — a close is verified only by the rescan", () => {
  it("leaves an agent claim unverified when closedFollowUpIds does not name it", () => {
    expect(buildGapRows([outcome({ lane: lane({}), deliverables: [closedRow] })])[0]!.verified).toBeUndefined();
  });

  it("stamps verified when the adjudicated set names the covered id", () => {
    const rows = buildGapRows([
      outcome({ lane: lane({}), closedFollowUpIds: ["rec-1"], deliverables: [closedRow] }),
    ]);
    expect(rows[0]!.verified).toBe(true);
  });

  it("does not stamp a retired row verified, even when the id is in the adjudicated set", () => {
    const rows = buildGapRows([
      outcome({
        lane: lane({}),
        closedFollowUpIds: ["rec-1"],
        deliverables: [{ ...closedRow, retired: true as const }],
      }),
    ]);
    expect(rows[0]!.retired).toBe(true);
    expect(rows[0]!.verified).toBeUndefined();
  });
});

describe("rowMeta — Closed is earned by the rescan", () => {
  it("says Claimed, not Closed, for an unverified close, in the muted italic tone", () => {
    const meta = rowMeta({ kind: "closed" });
    expect(meta.label).toBe("Claimed");
    expect(meta.glyph).not.toBe("✓");
    expect(meta.tone).toContain("italic");
  });

  it("says Closed / ✓ only when verified", () => {
    expect(rowMeta({ kind: "closed", verified: true })).toMatchObject({ label: "Closed", glyph: "✓" });
    expect(rowMeta({ kind: "closed", verified: true }).tone).toBeUndefined();
  });

  it("keeps Retired ahead of both Claimed and Closed", () => {
    expect(rowMeta({ kind: "closed", retired: true }).label).toBe("Retired");
    expect(rowMeta({ kind: "closed", retired: true, verified: true }).label).toBe("Retired");
  });
});
