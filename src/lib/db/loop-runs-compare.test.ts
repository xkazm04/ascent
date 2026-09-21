// THE COMPARISON READOUT'S PROJECTION (spark local-model-lanes, WP11).
//
// `buildComparisonReport` had no production caller: a comparison could be run and would produce rows
// nobody could read. These pin the one projection that closes that — a `compare` run's real lane rows
// onto `LaneMetricRow`, and a `single` run onto nothing.
//
// Pure: `runComparison` takes records, not a database.

import { describe, expect, it } from "vitest";
import { laneMetricRow, laneOutcomeClassOf, runComparison } from "@/lib/db/loop-runs-read";
import type { LoopLaneRecord, LoopRunRecord } from "@/lib/db/loop-runs-types";
import type { LaneEconomics } from "@/lib/local/lane-economics";
import type { Arm } from "@/lib/local/arm";

const CLAUDE_ARM: Arm = { id: "claude", label: "claude", transport: "claude", model: "sonnet" };
const SPLIT_ARM: Arm = { id: "split", label: "split", transport: "pi", model: "qwen3.8:27b", plan: { transport: "claude", model: "sonnet" } };

const lane = (over: Partial<LoopLaneRecord> = {}): LoopLaneRecord =>
  ({
    id: "lane-1", runId: "run-1", repoFullName: "o/r", cycle: 1, phase: "done", branch: "b",
    batchIds: ["rec-a"], closedIds: [], commits: 1, beforeScanId: "s0", afterScanId: "s1", stage: null,
    log: [], error: null, startedAt: "2026-09-21T10:00:00.000Z", endedAt: "2026-09-21T10:20:00.000Z",
    deliverables: [], model: "sonnet", costSource: "envelope", costMicros: 1_000,
    inputTokens: 100, outputTokens: 50, cacheReadTokens: null, turns: 2, agentDurationMs: 1_000,
    agentSessionId: null, abPairKey: "run-1:o/r:1", verifyVerdict: "verified", verifyCommand: "npm test",
    verifyRung: "primary", verifyNote: null, dimId: "D1", prNumber: null, prUrl: null, brief: null,
    report: null, executor: "local", claimedBy: null, leaseUntil: null, planId: null, heartbeatAt: null,
    stageAt: null, deadlineAt: null, activity: [], proposed: null, diffStat: null, landedAt: null,
    transport: "claude", armId: "claude", planModel: null, voidReason: null,
    planInputTokens: null, planOutputTokens: null,
    ...over,
  }) as LoopLaneRecord;

const run = (over: Partial<LoopRunRecord> = {}): LoopRunRecord =>
  ({ id: "run-1", orgId: "org-1", phase: "done", armPolicy: "compare", arms: [CLAUDE_ARM, SPLIT_ARM], ...over }) as LoopRunRecord;

const econ = (laneId: string, verifiedPoints: number | null): LaneEconomics =>
  ({ laneId, repo: "o/r", model: null, costMicros: null, verifiedPoints, microsPerVerifiedPoint: null, byDim: [], unproductive: false });

describe("how a lane ended, in the metric's vocabulary", () => {
  it("maps every phase, and never drops one", () => {
    expect(laneOutcomeClassOf(lane({ phase: "void", voidReason: "src/lib/scoring/x.ts" }))).toBe("void");
    expect(laneOutcomeClassOf(lane({ phase: "queued" }))).toBe("incomplete");
    expect(laneOutcomeClassOf(lane({ phase: "dispatching" }))).toBe("incomplete");
    expect(laneOutcomeClassOf(lane({ phase: "rescanning" }))).toBe("incomplete");
    expect(laneOutcomeClassOf(lane({ phase: "error", error: "the agent blew up" }))).toBe("failed");
    expect(laneOutcomeClassOf(lane({ phase: "done", commits: 3 }))).toBe("landed");
    expect(laneOutcomeClassOf(lane({ phase: "done", commits: 0 }))).toBe("failed");
  });

  it("a watchdog cut is TIMED-OUT, not pooled into `failed` — that is what makes it attributable", () => {
    const cut = lane({
      phase: "error",
      error: "Cycle 1 was FORCE-FAILED: it exceeded its 65 min deadline while the agent session was in flight, so the lane was cut loose.",
    });
    expect(laneOutcomeClassOf(cut)).toBe("timed-out");
  });

  it("a lane whose every item was parked is PARKED — its emptied batch is the evidence", () => {
    expect(laneOutcomeClassOf(lane({ phase: "done", commits: 0, batchIds: [] }))).toBe("parked");
  });
});

describe("one lane, projected", () => {
  it("carries the columns the metric reads, and omits what was never measured", () => {
    const row = laneMetricRow(lane({ costMicros: null, inputTokens: null, outputTokens: null }), CLAUDE_ARM, null);
    expect(row).toMatchObject({ laneId: "lane-1", armId: "claude", transport: "claude", outcome: "landed", trialKey: "run-1:o/r:1" });
    // Absent measurements are null, never 0: a 0 would be averaged downstream as a free session and
    // as a lane that measurably moved nothing.
    expect(row.costMicros).toBeNull();
    expect(row.inputTokens).toBeNull();
    expect(row.verifiedPoints).toBeNull();
    // Wall clock comes from the row's own two instants.
    expect(row.wallClockMs).toBe(20 * 60 * 1000);
  });

  it("writes `planTransport` ONLY for a split arm — an absent one means the executing half planned", () => {
    expect(laneMetricRow(lane({ armId: "claude" }), CLAUDE_ARM, 3)).not.toHaveProperty("planTransport");
    const split = laneMetricRow(lane({ armId: "split", transport: "pi", planModel: "sonnet" }), SPLIT_ARM, 3);
    expect(split.planTransport).toBe("claude");
  });

  it("marks `belowFloor` off the ARM, so the report need not carry the arm set", () => {
    const flagged = laneMetricRow(lane({ armId: "split" }), { ...SPLIT_ARM, belowFloor: true }, 1);
    expect(flagged.belowFloor).toBe(true);
    expect(laneMetricRow(lane(), CLAUDE_ARM, 1)).not.toHaveProperty("belowFloor");
  });
});

describe("the run's comparison", () => {
  const lanes = [
    lane({ id: "l1", armId: "claude", transport: "claude", commits: 2 }),
    lane({ id: "l2", armId: "split", transport: "pi", planModel: "sonnet", planInputTokens: 40, planOutputTokens: 10, commits: 2 }),
  ];
  const economics = [econ("l1", 4), econ("l2", 4)];

  it("a COMPARE run produces a report over its real lane rows", () => {
    const report = runComparison(run(), lanes, economics);
    expect(report).not.toBeNull();
    expect(report!.arms.map((a) => a.armId).sort()).toEqual(["claude", "split"]);
    expect(report!.optimized.id).toBe("claude-tokens-per-verified-point");
    expect(report!.constraints.length).toBeGreaterThan(0);
  });

  it("a SINGLE run produces nothing — one arm is not a comparison", () => {
    expect(runComparison(run({ armPolicy: "single", arms: [CLAUDE_ARM] }), lanes, economics)).toBeNull();
    expect(runComparison(run({ armPolicy: null }), lanes, economics)).toBeNull();
  });

  it("a compare run whose lanes carry no arm id produces nothing rather than one pooled population", () => {
    const unjoinable = lanes.map((l) => ({ ...l, armId: null }));
    expect(runComparison(run(), unjoinable, economics)).toBeNull();
  });

  it("the split arm's PLANNING tokens are attributed to Claude — the optimized metric's whole point", () => {
    const report = runComparison(run(), lanes, economics)!;
    const split = report.arms.find((a) => a.armId === "split")!;
    const claude = report.arms.find((a) => a.armId === "claude")!;
    // 50 planning tokens on Claude against 150 for the all-Claude arm, over the same 4 points.
    expect(split.claudeTokensPerVerifiedPoint).toBeLessThan(claude.claudeTokensPerVerifiedPoint as number);
  });
});
