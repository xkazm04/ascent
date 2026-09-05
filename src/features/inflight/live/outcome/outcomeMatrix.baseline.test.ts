// AN UNAVAILABLE BASELINE ON THE (RUN, REPO) CELL — the one degradation-guard verdict the sheet surfaces.
//
// It says the repository's OWN check was already failing when the lane opened, so the guard had
// nothing green to compare against: every other number in the cell was produced with the safety net
// off, and a reader has to be told that before they read them. Split from `outcomeMatrix.test.ts` to
// keep both files under this tree's 200-line cap.

import { describe, expect, it } from "vitest";
import { DIMENSIONS } from "@/lib/maturity/model";
import type { ComparableScan } from "@/lib/db/scans";
import type { LoopLaneOutcome, LoopLaneRecord, LoopRunDetail } from "../cockpit/loopTypes";
import { buildOutcomeMatrix } from "./outcomeMatrix";

const scan = (id: string): ComparableScan => ({
  id, scannedAt: "2026-08-31T10:00:00.000Z", overallScore: 50, level: "L3", levelName: "Augmented", archetype: "org",
  adoptionScore: 50, rigorScore: 50, posture: "manual", confidence: 0.8, engineProvider: "anthropic", engineModel: "claude",
  engineDegraded: false, headSha: null, recommendations: [],
  dimensions: DIMENSIONS.map((d) => ({ dimId: d.id, name: d.name, score: 50, signalScore: 50, evidence: [], gaps: [] })),
});

const lane = (o: Partial<LoopLaneRecord>): LoopLaneRecord => ({
  id: "l", runId: "run-9", repoFullName: "acme/one", cycle: 1, phase: "done", branch: null, batchIds: [], closedIds: [],
  commits: 2, beforeScanId: "b", afterScanId: "a", stage: null, log: [], error: null, startedAt: null, endedAt: null,
  deliverables: [], ...o,
});

const outcome = (l: LoopLaneRecord): LoopLaneOutcome => ({
  lane: l, kind: "backlog", before: scan("b"), after: scan("a"), diff: null, closedFollowUpIds: [], commits: 2, deliverables: [],
});

const cellOf = (...lanes: LoopLaneRecord[]) => {
  const detail: LoopRunDetail = {
    run: {
      id: "run-9", orgId: "o", createdBy: null, phase: "done", repos: ["acme/one"], targets: [], concurrency: 2, maxCycles: 3,
      cycle: 1, curated: true, model: "sonnet", effort: null, startedAt: "2026-08-31T10:00:00Z", endedAt: null, error: null,
      createdAt: "2026-08-31T10:00:00Z",
    },
    lanes,
    outcomes: lanes.map(outcome),
  };
  return buildOutcomeMatrix([detail]).groups[0]!.cells["run-9"]!;
};

describe("the cell's unavailable baseline", () => {
  it("carries the command and the note when the lane could not establish a baseline", () => {
    const cell = cellOf(
      lane({
        verifyVerdict: "baseline-unavailable",
        verifyCommand: "npm run test:unit",
        verifyNote: "Verification NO BASELINE: `npm run test:unit` … First failure: ✖ fault-injection",
      }),
    );
    expect(cell.redBaseline).toEqual({ command: "npm run test:unit", note: expect.stringContaining("✖ fault-injection") });
  });

  it("is null for a verified lane — a badge on every healthy row would mean 'normal'", () => {
    expect(cellOf(lane({ verifyVerdict: "verified", verifyCommand: "npm test" })).redBaseline).toBeNull();
  });

  it("is null for a lane written BEFORE the guard existed — unknown is not a claim", () => {
    expect(cellOf(lane({ verifyVerdict: null })).redBaseline).toBeNull();
  });

  it("follows the NEWEST lane of the cell: a later green cycle clears it", () => {
    const cell = cellOf(
      lane({ id: "c1", cycle: 1, verifyVerdict: "baseline-unavailable", verifyCommand: "npm test" }),
      lane({ id: "c2", cycle: 2, verifyVerdict: "verified", verifyCommand: "npm test" }),
    );
    expect(cell.redBaseline).toBeNull();
  });
});

// ── VERIFIED, BUT NOT AGAINST THE TESTS ───────────────────────────────────────────
//
// A worktree carries no gitignored credentials, service config or local database, so on a realistic
// application the declared command cannot establish a baseline there. The guard now degrades to the
// strongest HERMETIC check that can — a typecheck, then a lint — and the lane IS verified and IS
// deliverable. Against `npm run typecheck`, not against the suite. The badge is the only thing
// standing between a reader of this column and a false belief, so it is pinned here.
describe("the cell's narrowed verification", () => {
  it("labels a lane verified against a narrowed rung, and carries the guard's note for the hover", () => {
    const cell = cellOf(
      lane({
        verifyVerdict: "verified",
        verifyCommand: "npm run typecheck",
        verifyRung: "typecheck",
        verifyNote: "Verification NARROWED — verified against `npm run typecheck` ONLY …",
      }),
    );
    expect(cell.narrowedVerify).toEqual({
      label: "typecheck only",
      command: "npm run typecheck",
      note: expect.stringContaining("NARROWED"),
    });
  });

  it("says nothing for an unqualified verified lane — the normal case is not a badge", () => {
    expect(cellOf(lane({ verifyVerdict: "verified", verifyCommand: "npm test", verifyRung: "primary" })).narrowedVerify).toBeNull();
  });

  it("says nothing for a lane written before the ladder — an unknown rung is not `primary` and not a claim", () => {
    expect(cellOf(lane({ verifyVerdict: "verified", verifyCommand: "npm test", verifyRung: null })).narrowedVerify).toBeNull();
  });

  it("never badges a verdict that is not `verified` — a no-baseline cell has its own word", () => {
    const cell = cellOf(lane({ verifyVerdict: "baseline-unavailable", verifyCommand: "npm test", verifyRung: "primary" }));
    expect(cell.narrowedVerify).toBeNull();
    expect(cell.redBaseline).not.toBeNull();
  });

  it("follows the NEWEST lane: a later full verification clears the narrowed label", () => {
    const cell = cellOf(
      lane({ id: "c1", cycle: 1, verifyVerdict: "verified", verifyCommand: "npm run lint", verifyRung: "lint" }),
      lane({ id: "c2", cycle: 2, verifyVerdict: "verified", verifyCommand: "npm test", verifyRung: "primary" }),
    );
    expect(cell.narrowedVerify).toBeNull();
  });
});
