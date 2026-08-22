// @vitest-environment jsdom
//
// The outcome ledger renders a REAL diffScans result — the fixture goes through the same engine the
// repo's compare view uses, so a change to the diff shape breaks this test rather than silently
// blanking the panel. Two things are load-bearing:
//   - a lane with both ends shows before → after and the signed lift;
//   - a lane WITHOUT a before says so, instead of printing a +0 that reads as "nothing happened".

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CockpitOutcome } from "./CockpitOutcome";
import { diffScans } from "@/lib/report/compare";
import { DIMENSIONS } from "@/lib/maturity/model";
import type { ComparableDimension, ComparableScan } from "@/lib/db/scans";
import type { LoopLaneOutcome, LoopLaneRecord, LoopRunDetail } from "./loopTypes";

const dims = (overrides: Record<string, { score?: number; gaps?: string[]; evidence?: string[] }> = {}): ComparableDimension[] =>
  DIMENSIONS.map((d) => {
    const o = overrides[d.id];
    const score = o?.score ?? 50;
    return { dimId: d.id, name: d.name, score, signalScore: score, evidence: o?.evidence ?? [], gaps: o?.gaps ?? [] };
  });

const scan = (p: Partial<ComparableScan> & { id: string }): ComparableScan => ({
  scannedAt: "2026-08-22T10:00:00.000Z",
  overallScore: 50,
  level: "L3",
  levelName: "Augmented",
  archetype: "org",
  adoptionScore: 50,
  rigorScore: 50,
  posture: "manual",
  confidence: 0.8,
  engineProvider: "mock",
  headSha: null,
  dimensions: dims(),
  recommendations: [],
  ...p,
});

const lane = (o: Partial<LoopLaneRecord> = {}): LoopLaneRecord => ({
  id: "lane-1",
  runId: "run-1",
  repoFullName: "acme/one",
  cycle: 1,
  phase: "done",
  branch: "ascent/loop-1",
  batchIds: [],
  closedIds: ["rec-1", "rec-2"],
  commits: 3,
  beforeScanId: "b",
  afterScanId: "a",
  stage: null,
  log: [],
  error: null,
  startedAt: null,
  endedAt: null,
  ...o,
});

const before = scan({ id: "b", overallScore: 40, dimensions: dims({ D2: { score: 40, evidence: ["Found 6 test files"] } }) });
const after = scan({ id: "a", overallScore: 52, dimensions: dims({ D2: { score: 64, evidence: ["Found 6 test files", "Coverage tracking configured"] } }) });

const outcome = (o: Partial<LoopLaneOutcome> = {}): LoopLaneOutcome => ({
  lane: lane(),
  before,
  after,
  diff: diffScans(before, after),
  closedFollowUpIds: ["rec-1", "rec-2"],
  commits: 3,
  ...o,
});

const detail = (outcomes: LoopLaneOutcome[]): LoopRunDetail => ({
  run: {
    id: "run-1",
    orgId: "org-1",
    createdBy: "kaz",
    phase: "done",
    repos: outcomes.map((o) => o.lane.repoFullName),
    concurrency: 2,
    maxCycles: 3,
    cycle: 2,
    curated: true,
    startedAt: "2026-08-22T10:00:00Z",
    endedAt: "2026-08-22T10:30:00Z",
    error: null,
    createdAt: "2026-08-22T10:00:00Z",
  },
  lanes: outcomes.map((o) => o.lane),
  outcomes,
});

describe("CockpitOutcome", () => {
  it("stamps the before → after pair, the lift, and the dimension that moved", () => {
    render(<CockpitOutcome detail={detail([outcome()])} onReplay={vi.fn()} onBack={vi.fn()} canReplay />);
    expect(screen.getByText("40 → 52")).toBeInTheDocument();
    // +12 appears twice: the header total and the row's own lift.
    expect(screen.getAllByText(/\+12/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Testing")).toBeInTheDocument();
    expect(screen.getAllByText(/\+24/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/3 commits/)).toBeInTheDocument();
    expect(screen.getByText(/2 follow-ups closed/)).toBeInTheDocument();
    expect(screen.getByText("ascent/loop-1")).toBeInTheDocument();
  });

  it("tallies improved / flat / regressed across the lanes", () => {
    const flat = outcome({
      lane: lane({ id: "lane-2", repoFullName: "acme/two" }),
      before,
      after: scan({ id: "a2", overallScore: 40 }),
      diff: diffScans(before, scan({ id: "a2", overallScore: 40 })),
    });
    render(<CockpitOutcome detail={detail([outcome(), flat])} onReplay={vi.fn()} onBack={vi.fn()} canReplay />);
    expect(screen.getByText("1 improved · 1 flat · 0 regressed")).toBeInTheDocument();
  });

  it("refuses to print a movement it cannot measure", () => {
    const unmeasured = outcome({ before: null, diff: null });
    render(<CockpitOutcome detail={detail([unmeasured])} onReplay={vi.fn()} onBack={vi.fn()} canReplay={false} />);
    expect(screen.getByText("not measured")).toBeInTheDocument();
    expect(screen.getByText(/no diff/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay run" })).toBeDisabled();
  });

  it("offers replay and a way back to the inspector", () => {
    const onReplay = vi.fn();
    const onBack = vi.fn();
    render(<CockpitOutcome detail={detail([outcome()])} onReplay={onReplay} onBack={onBack} canReplay />);
    fireEvent.click(screen.getByRole("button", { name: "Replay run" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to inspect" }));
    expect(onReplay).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
