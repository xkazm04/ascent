// MC-B44 — THE OUTCOME COLUMN NAMES ITS ENGINE.
//
// The header printed `agentConfig` ("opus · high effort") and stopped: a model, never who ran it. A
// run Ascent spawned itself in a worktree on this machine and a run some agent elsewhere claimed over
// MCP therefore read identically — and on the second one the model line is only what Ascent ARMED,
// which the claimant is under no obligation to have used.
//
// The fact is DERIVED, not newly recorded: `LoopLaneRecord.executor` already carries it, the local
// path has exactly one engine (`src/lib/local/agent.ts` spawns `CLAUDE_CLI_PATH || "claude"`), and the
// usage meter stamps that same population `provider: "claude-cli"` (`lane-cost.ts`). No schema change,
// no new column, nothing guessed.

import { describe, expect, it } from "vitest";
import type { LoopLaneRecord, LoopRunDetail } from "../cockpit/loopTypes";
import { runEngineLabel } from "../cockpit/loopTypes";
import { buildOutcomeMatrix } from "./outcomeMatrix";

const lane = (o: Partial<LoopLaneRecord> & { id: string }): LoopLaneRecord =>
  ({
    runId: "run-1", repoFullName: "acme/one", cycle: 1, phase: "done", branch: null, batchIds: [], closedIds: [],
    commits: 0, beforeScanId: null, afterScanId: null, stage: null, log: [], error: null, startedAt: null,
    endedAt: null, deliverables: [], executor: "local", claimedBy: null, leaseUntil: null, ...o,
  }) as LoopLaneRecord;

const detail = (lanes: LoopLaneRecord[]): LoopRunDetail =>
  ({
    run: {
      id: "run-1", orgId: "o", createdBy: null, phase: "done", repos: [], targets: [], concurrency: 1,
      maxCycles: 1, cycle: 1, curated: true, model: "opus", effort: "high",
      startedAt: "2026-08-30T10:00:00Z", endedAt: null, error: null, createdAt: "2026-08-30T10:00:00Z",
    },
    lanes,
    outcomes: [],
  }) as unknown as LoopRunDetail;

describe("runEngineLabel", () => {
  it("names the claude CLI when Ascent spawned every lane itself", () => {
    expect(runEngineLabel([lane({ id: "a" }), lane({ id: "b" })])).toBe("claude CLI");
  });

  it("names the claimant, not an engine, when every lane was pulled over MCP", () => {
    // Ascent started no process for these: their engine is genuinely not ours to report, so the label
    // says WHO ran it and stops. Reporting "claude CLI" here would be a fabricated claim.
    const lanes = [lane({ id: "a", executor: "remote-agent" }), lane({ id: "b", executor: "remote-agent" })];
    expect(runEngineLabel(lanes)).toBe("remote agent");
  });

  it("refuses to pick a majority on a mixed run", () => {
    const lanes = [lane({ id: "a" }), lane({ id: "b", executor: "remote-agent" })];
    expect(runEngineLabel(lanes)).toBe("mixed engines");
  });

  it("renders NOTHING for a run with no lanes — never 'claude CLI' by default", () => {
    // The whole point of the label: an unknown engine must not silently become the common one.
    expect(runEngineLabel([])).toBeNull();
  });
});

describe("buildOutcomeMatrix — the column carries the engine beside the model", () => {
  it("derives the engine from the run's lanes, not from a run-row column", () => {
    const m = buildOutcomeMatrix([detail([lane({ id: "a" })])]);
    expect(m.columns[0]!.engine).toBe("claude CLI");
    // The model is still its own, separate fact.
    expect(m.columns[0]!.agentConfig).toBe("opus · high effort");
  });

  it("folds over ALL lanes, so one unfinished remote lane cannot be dropped from the reading", () => {
    // `outcomes` holds only lanes with a before/after; a remote lane nobody has claimed yet has
    // neither, so folding over outcomes would have printed "claude CLI" for a half-remote run.
    const m = buildOutcomeMatrix([detail([lane({ id: "a" }), lane({ id: "b", executor: "remote-agent", phase: "queued" })])]);
    expect(m.columns[0]!.engine).toBe("mixed engines");
  });

  it("says nothing about the engine of a run that has no lanes", () => {
    const m = buildOutcomeMatrix([detail([])]);
    expect(m.columns[0]!.engine).toBeNull();
  });
});
