// Pins the trend-timeline annotation derivation (G5-18): which scans become markers, what they say,
// and — critically — the threshold they share with the alerting path.

import { describe, it, expect } from "vitest";
import { deriveTrendAnnotations } from "@/app/trends/annotations";
import { DEFAULT_THRESHOLDS } from "@/lib/alerts";
import type { HistoryPoint } from "@/lib/db/scans";

function pt(
  id: string,
  scannedAt: string,
  overallScore: number,
  level = "L3",
  headSha: string | null = null,
): HistoryPoint {
  return {
    id,
    headSha,
    overallScore,
    level,
    levelName: `Level ${level}`,
    confidence: 0.9,
    engineProvider: "test",
    engineModel: "test",
    scannedAt,
    dimensions: [],
  };
}

describe("deriveTrendAnnotations", () => {
  it("marks a band crossing as a promotion, keyed to the newer scan's timestamp", () => {
    // newest-first
    const scans = [pt("b", "2026-03-01T00:00:00.000Z", 68, "L4"), pt("a", "2026-02-01T00:00:00.000Z", 60, "L3")];
    const out = deriveTrendAnnotations(scans);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "promotion", label: "L3 → L4", at: "2026-03-01T00:00:00.000Z", delta: 8 });
  });

  it("marks a downward band crossing as a demotion", () => {
    const scans = [pt("b", "2026-03-01T00:00:00.000Z", 42, "L2"), pt("a", "2026-02-01T00:00:00.000Z", 60, "L3")];
    const out = deriveTrendAnnotations(scans);
    expect(out[0]).toMatchObject({ kind: "demotion", label: "L3 → L2", delta: -18 });
  });

  it("uses the SAME regression threshold as the alerting path (a drop of exactly overallDrop counts)", () => {
    const drop = DEFAULT_THRESHOLDS.overallDrop;
    const exact = [pt("b", "2026-03-01T00:00:00.000Z", 60 - drop), pt("a", "2026-02-01T00:00:00.000Z", 60)];
    const under = [pt("b", "2026-03-01T00:00:00.000Z", 60 - drop + 1), pt("a", "2026-02-01T00:00:00.000Z", 60)];
    expect(deriveTrendAnnotations(exact).map((a) => a.kind)).toEqual(["regression"]);
    expect(deriveTrendAnnotations(under)).toEqual([]); // one point shy — not an event
  });

  it("emits at most ONE annotation per scan — a band crossing outranks the regression on the same scan", () => {
    const scans = [pt("b", "2026-03-01T00:00:00.000Z", 40, "L2"), pt("a", "2026-02-01T00:00:00.000Z", 60, "L3")];
    const out = deriveTrendAnnotations(scans);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("demotion");
  });

  it("never annotates the OLDEST scan — a baseline is not an event", () => {
    expect(deriveTrendAnnotations([pt("only", "2026-01-01T00:00:00.000Z", 50)])).toEqual([]);
    expect(deriveTrendAnnotations([])).toEqual([]);
  });

  it("carries the short sha when the scan pinned to a commit", () => {
    const scans = [
      pt("b", "2026-03-01T00:00:00.000Z", 68, "L4", "4f3a91cdeadbeef"),
      pt("a", "2026-02-01T00:00:00.000Z", 60, "L3"),
    ];
    const out = deriveTrendAnnotations(scans);
    expect(out[0]!.sha).toBe("4f3a91c"); // short, for display
    expect(out[0]!.commitSha).toBe("4f3a91cdeadbeef"); // full, for permalinks
    expect(out[0]!.detail).toContain("4f3a91c");
  });

  it("returns markers newest-first, one per qualifying pair", () => {
    const scans = [
      pt("c", "2026-03-01T00:00:00.000Z", 70, "L4"),
      pt("b", "2026-02-01T00:00:00.000Z", 62, "L3"),
      pt("a", "2026-01-01T00:00:00.000Z", 75, "L4"),
    ];
    const out = deriveTrendAnnotations(scans);
    expect(out.map((a) => [a.scanId, a.kind])).toEqual([
      ["c", "promotion"],
      ["b", "demotion"],
    ]);
  });
});
