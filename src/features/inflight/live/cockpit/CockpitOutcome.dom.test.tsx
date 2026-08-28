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
import { MOCK_ENGINE, SCORE_NOISE_BAND } from "@/lib/maturity/attribution";
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
  // A REAL engine by default: the attribution rule refuses a pair with a mock end, so a fixture on
  // the mock floor would make every lift in this file unmeasurable — which is the rule working, but
  // it is not what these cases are about. The mock case has its own test below.
  engineProvider: "anthropic",
  engineModel: "claude",
  engineDegraded: false,
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
    // A run older than the agent-config columns — unknown, which renders as nothing. The cases that
    // exercise a KNOWN configuration live in CockpitOutcome.agent.dom.test.tsx (200-LOC cap).
    model: null,
    effort: null,
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

  // The whole point of the attribution rule is what the ledger REFUSES to print. Each of these is a
  // number the row used to render green.
  it("refuses a green delta across the mock floor, and says why", () => {
    const mocked = outcome({
      before: scan({ id: "bm", overallScore: 10, engineProvider: MOCK_ENGINE }),
      after: scan({ id: "am", overallScore: 90, engineProvider: MOCK_ENGINE }),
      diff: null,
    });
    render(<CockpitOutcome detail={detail([mocked])} onReplay={vi.fn()} onBack={vi.fn()} canReplay />);
    expect(screen.getByText("10 → 90")).toBeInTheDocument();
    expect(screen.getByText("not attributable: mock scan")).toBeInTheDocument();
    expect(screen.queryByText(/\+80/)).toBeNull();
    expect(screen.getByText(/excluded: 1 mock scan/)).toBeInTheDocument();
  });

  it("words a DEGRADED end apart from a keyless one — they call for opposite next moves", () => {
    const deg = outcome({
      before,
      after: scan({ id: "ad", overallScore: 90, engineProvider: MOCK_ENGINE, engineDegraded: true }),
      diff: null,
    });
    render(<CockpitOutcome detail={detail([deg])} onReplay={vi.fn()} onBack={vi.fn()} canReplay />);
    expect(screen.getByText(/the model failed and this scan fell to the deterministic floor/)).toBeInTheDocument();
  });

  it("prints the band instead of a delta when a real pair moved less than it", () => {
    const noise = outcome({ before, after: scan({ id: "an", overallScore: 42 }), diff: null });
    render(<CockpitOutcome detail={detail([noise])} onReplay={vi.fn()} onBack={vi.fn()} canReplay />);
    expect(screen.getByText(`within noise (±${SCORE_NOISE_BAND})`)).toBeInTheDocument();
    // The headline agrees with the row: no attributable lane means no lift, not "+2".
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/excluded: 1 within noise/)).toBeInTheDocument();
  });

  it("discloses the engine behind the pair, and the integrity levers that fired", () => {
    const withIntegrity = outcome({
      before,
      after: scan({
        id: "ai",
        overallScore: 52,
        scoreIntegrity: { d9Unmeasurable: true, widenedDims: ["D2"], effectiveBlend: 0.6 },
      }),
    });
    render(<CockpitOutcome detail={detail([withIntegrity])} onReplay={vi.fn()} onBack={vi.fn()} canReplay />);
    expect(screen.getByText(/engine anthropic · claude/)).toBeInTheDocument();
    expect(screen.getByText("D9 renormalized out")).toBeInTheDocument();
    expect(screen.getByText("widened D2")).toBeInTheDocument();
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

