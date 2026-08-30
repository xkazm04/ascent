// @vitest-environment jsdom
//
// The outcome ledger's ECONOMICS line (moonshot #27). A sibling file rather than more cases in
// CockpitOutcome.dom.test.tsx, which is at 195 of the 200-LOC cap AGENTS.md sets under src/features.
//
// What is load-bearing here is the refusal, not the arithmetic (that is pinned in
// src/lib/local/lane-economics.test.ts): a lane whose cost the CLI never reported must say so, and
// must never print a zero that a reader would take for a free session.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CockpitOutcome } from "./CockpitOutcome";
import { diffScans } from "@/lib/report/compare";
import { DIMENSIONS } from "@/lib/maturity/model";
import type { ComparableDimension, ComparableScan } from "@/lib/db/scans";
import type { LoopLaneOutcome, LoopLaneRecord, LoopRunDetail } from "./loopTypes";

const dims = (overrides: Record<string, { score?: number }> = {}): ComparableDimension[] =>
  DIMENSIONS.map((d) => {
    const score = overrides[d.id]?.score ?? 50;
    return { dimId: d.id, name: d.name, score, signalScore: score, evidence: [], gaps: [] };
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
  closedIds: [],
  commits: 3,
  beforeScanId: "b",
  afterScanId: "a",
  stage: null,
  log: [],
  error: null,
  startedAt: null,
  endedAt: null,
  model: "sonnet",
  costSource: "envelope",
  costMicros: 48_000_000, // 48¢
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  turns: 4,
  agentDurationMs: null,
  agentSessionId: null,
  abPairKey: null,
  ...o,
});

const before = scan({ id: "b", overallScore: 40, dimensions: dims({ D2: { score: 40 } }) });
const after = scan({ id: "a", overallScore: 52, dimensions: dims({ D2: { score: 64 } }) });

const detail = (o: Partial<LoopLaneOutcome> = {}): LoopRunDetail => {
  const outcome: LoopLaneOutcome = {
    lane: lane(),
    kind: "backlog",
    before,
    after,
    diff: diffScans(before, after),
    closedFollowUpIds: [],
    commits: 3,
    ...o,
  };
  return {
    run: {
      id: "run-1",
      orgId: "org-1",
      createdBy: "kaz",
      phase: "done",
      repos: [outcome.lane.repoFullName],
      targets: [{ repo: outcome.lane.repoFullName, kind: "backlog", practiceId: null }],
      concurrency: 2,
      maxCycles: 3,
      cycle: 1,
      curated: true,
      startedAt: "2026-08-22T10:00:00Z",
      endedAt: "2026-08-22T10:30:00Z",
      error: null,
      createdAt: "2026-08-22T10:00:00Z",
      model: "sonnet",
      effort: null,
      modelPolicy: "single",
      models: ["sonnet"],
    },
    lanes: [outcome.lane],
    outcomes: [outcome],
    economics: [],
  };
};

const render1 = (d: LoopRunDetail) => render(<CockpitOutcome detail={d} onReplay={vi.fn()} onBack={vi.fn()} canReplay />);

describe("the outcome row's cost line", () => {
  it("prints what the lane spent and what a verified point cost", () => {
    render1(detail());
    // 48¢ over the positive D2 delta (+24) is 2.00¢ a point.
    expect(screen.getByTestId("lane-ratio").textContent).toContain("48.00¢ spent");
    expect(screen.getByTestId("lane-ratio").textContent).toContain("2.00¢/point");
  });

  it("says the cost was not measured rather than printing a zero", () => {
    render1(detail({ lane: lane({ costMicros: null }) }));
    expect(screen.getByTestId("lane-ratio").textContent).toBe("cost not measured");
  });

  it("names spend that bought no measurable movement instead of hiding it", () => {
    // The same scan on both ends: real money, no positive delta anywhere.
    render1(detail({ after: before, diff: diffScans(before, before) }));
    expect(screen.getByTestId("lane-ratio").textContent).toContain("no measured movement");
  });
});
