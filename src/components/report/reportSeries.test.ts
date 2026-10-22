import { describe, expect, it } from "vitest";
import type { ScanReport } from "@/lib/types";
import type { HistoryPoint, RepositoryHistory } from "@/lib/db/scans";
import { computeReportSeries } from "@/components/report/reportSeries";
import { scoreBridge } from "@/components/report/scoreBridgeModel";

// charts-1: the series exposes the SAME baseline scan it already uses for overallDelta, so the
// waterfall's since-last-scan bridge and the ScoringTab DeltaPill can never disagree.

const AT = "2026-10-20T12:00:00.000Z";

function report(overall: number): ScanReport {
  return {
    overallScore: overall,
    scannedAt: AT,
    archetype: "application",
    dimensions: [
      { id: "D1", name: "D1", score: overall, weight: 0.5 },
      { id: "D2", name: "D2", score: overall, weight: 0.5 },
    ],
    engine: { provider: "claude", model: "m", rubricVersion: "r24" },
  } as unknown as ScanReport;
}

function point(id: string, overall: number, at: string, dims: boolean | "empty" = true): HistoryPoint {
  return {
    id,
    headSha: null,
    overallScore: overall,
    level: "L3",
    levelName: "x",
    confidence: 1,
    engineProvider: "claude",
    engineModel: "m",
    rubricVersion: "r24",
    scannedAt: at,
    ...(dims === true ? { dimensions: [{ dimId: "D1", score: overall }, { dimId: "D2", score: overall - 2 }] } : {}),
    ...(dims === "empty" ? { dimensions: [] } : {}),
  } as HistoryPoint;
}

const hist = (scans: HistoryPoint[]) => ({ scans }) as unknown as RepositoryHistory;

const FIXTURES: { name: string; history: RepositoryHistory | null; now: number }[] = [
  { name: "no history", history: null, now: 60 },
  { name: "current stored, one older", history: hist([point("cur", 62, AT), point("old", 58, "2026-10-01T00:00:00.000Z")]), now: 62 },
  { name: "current NOT stored, two older", history: hist([point("a", 55, "2026-10-10T00:00:00.000Z"), point("b", 50, "2026-10-01T00:00:00.000Z")]), now: 61 },
  { name: "near-identical instant stored", history: hist([point("cur", 70, "2026-10-20T12:00:00.400Z"), point("old", 72, "2026-09-01T00:00:00.000Z")]), now: 70 },
  { name: "baseline join skipped", history: hist([point("old", 40, "2026-10-01T00:00:00.000Z", false)]), now: 45 },
];

describe("computeReportSeries - baseline (additive)", () => {
  it("returns the baseline {id, overallScore, engineProvider, rubricVersion, dimensions} it diffs against", () => {
    const s = computeReportSeries(FIXTURES[1]!.history, report(62));
    expect(s.baseline).toEqual({
      id: "old",
      overallScore: 58,
      engineProvider: "claude",
      rubricVersion: "r24",
      dimensions: [{ dimId: "D1", score: 58 }, { dimId: "D2", score: 56 }],
    });
  });

  it("null baseline when there is no older scan", () => {
    expect(computeReportSeries(null, report(60)).baseline).toBeNull();
  });

  it("a skipped dimensions join stays undefined on the baseline (unknown, not zero)", () => {
    const s = computeReportSeries(FIXTURES[4]!.history, report(45));
    expect(s.baseline?.dimensions).toBeUndefined();
  });

  for (const f of FIXTURES) {
    it(`bridge.to - bridge.from === overallDelta (${f.name})`, () => {
      const r = report(f.now);
      const s = computeReportSeries(f.history, r);
      const b = scoreBridge(r, s.baseline);
      if (b.kind === "bridge") expect(b.to - b.from).toBe(s.overallDelta);
      else if (s.baseline) expect(b.reason).toBe("no-dimensions");
      else expect(s.overallDelta).toBeNull();
    });
  }
});
