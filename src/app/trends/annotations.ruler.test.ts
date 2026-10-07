// The ruler rule on the trend timeline: a pair scored under two provably different rubrics measures the
// rubric, not the repository, so it never reads as a regression or a band crossing. The policy is the
// alert lane's (scan-alerts.ts): only `sameRuler === false` refuses a pair; a null end does not.

import { describe, it, expect } from "vitest";
import { deriveTrendAnnotations } from "@/app/trends/annotations";
import { DEFAULT_THRESHOLDS } from "@/lib/alerts";
import type { HistoryPoint } from "@/lib/db/scans";

function pt(id: string, scannedAt: string, overallScore: number, rubricVersion: string | null, level = "L3"): HistoryPoint {
  return {
    id,
    headSha: null,
    overallScore,
    level,
    levelName: `Level ${level}`,
    confidence: 0.9,
    engineProvider: "test",
    engineModel: "test",
    rubricVersion,
    scannedAt,
    dimensions: [],
  };
}

const BIG_DROP = DEFAULT_THRESHOLDS.overallDrop + 5;

describe("deriveTrendAnnotations — the ruler", () => {
  it("a drop across a provable rubric change yields one rubric-change marker and no regression", () => {
    const scans = [pt("b", "2026-03-01T00:00:00.000Z", 60 - BIG_DROP, "r18"), pt("a", "2026-02-01T00:00:00.000Z", 60, "r17")];
    const out = deriveTrendAnnotations(scans);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "rubric", label: "r17 → r18", at: "2026-03-01T00:00:00.000Z" });
    expect(out[0]!.detail).toMatch(/rubric, not the repository/);
  });

  it("a band crossing across a rubric change is not a promotion or demotion either", () => {
    const scans = [pt("b", "2026-03-01T00:00:00.000Z", 70, "r18", "L4"), pt("a", "2026-02-01T00:00:00.000Z", 60, "r17", "L3")];
    expect(deriveTrendAnnotations(scans).map((a) => a.kind)).toEqual(["rubric"]);
  });

  it("the same drop under one rubric is still a regression", () => {
    const scans = [pt("b", "2026-03-01T00:00:00.000Z", 60 - BIG_DROP, "r18"), pt("a", "2026-02-01T00:00:00.000Z", 60, "r18")];
    expect(deriveTrendAnnotations(scans).map((a) => a.kind)).toEqual(["regression"]);
  });

  it("a null rubric on one end behaves as it did: the drop is a regression", () => {
    const scans = [pt("b", "2026-03-01T00:00:00.000Z", 60 - BIG_DROP, "r18"), pt("a", "2026-02-01T00:00:00.000Z", 60, null)];
    expect(deriveTrendAnnotations(scans).map((a) => a.kind)).toEqual(["regression"]);
  });
});
