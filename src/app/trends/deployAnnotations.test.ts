// Pins how persisted Deployment rows become trend-timeline markers (kind "deploy"):
//   • a deploy pins to a REAL scan, by sha equality first, else to the first scan after it;
//   • deploys outside the scanned span (before the baseline, after the newest scan) are not placed;
//   • no rows → no markers, never invented; a compacted period is never a pin target;
//   • the marker says "deployment status", never "incident", and a failure is counted, not hidden.

import { describe, expect, it } from "vitest";
import { deriveDeployAnnotations, mergeTimelineEvents, MAX_DEPLOYS_IN_DETAIL } from "@/app/trends/deployAnnotations";
import { deriveTrendAnnotations } from "@/app/trends/annotations";
import type { HistoryPoint } from "@/lib/db/scans";
import type { RepoDeployment } from "@/lib/db/repo-deployments";

function pt(id: string, scannedAt: string, overallScore: number, headSha: string | null = null): HistoryPoint {
  return {
    id,
    headSha,
    overallScore,
    level: "L3",
    levelName: "Integrating",
    confidence: 0.9,
    engineProvider: "test",
    engineModel: "test",
    rubricVersion: null,
    scannedAt,
  };
}

function dep(createdAt: string, state = "success", sha = "f".repeat(40), environment = "production"): RepoDeployment {
  return { environment, sha, state, createdAt };
}

// newest-first, like every history reader
const SCANS = [
  pt("s3", "2026-09-20T00:00:00.000Z", 60, "c".repeat(40)),
  pt("s2", "2026-09-10T00:00:00.000Z", 66, "b".repeat(40)),
  pt("s1", "2026-09-01T00:00:00.000Z", 64, "a".repeat(40)),
];

describe("deriveDeployAnnotations", () => {
  it("guard: an empty Deployment table yields zero markers", () => {
    expect(deriveDeployAnnotations(SCANS, [])).toEqual([]);
  });

  it("pins a deploy between two scans to the first scan after it, timestamp-identical to that point", () => {
    const out = deriveDeployAnnotations(SCANS, [dep("2026-09-15T12:00:00.000Z", "failure")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "deploy",
      at: "2026-09-20T00:00:00.000Z",
      scanId: "s3",
      delta: -6,
      label: "1 failed",
      deploys: { count: 1, failed: 1, environments: ["production"] },
    });
    expect(out[0]!.detail).toMatch(/^Deployment status, not incidents:/);
    expect(out[0]!.detail).toContain("production failure at fffffff on 2026-09-15");
    expect(out[0]!.detail).not.toMatch(/incident(?!s:)/);
  });

  it("pins by sha equality before time: a deploy of a scanned commit lands on that scan", () => {
    // Deployed long after s1 was scanned, but it shipped exactly the code s1 measured.
    const out = deriveDeployAnnotations(SCANS, [dep("2026-09-18T00:00:00.000Z", "success", "A".repeat(40))]);
    expect(out.map((a) => a.scanId)).toEqual(["s1"]);
    expect(out[0]!.label).toBe("deploy");
  });

  it("does not place a deploy before the baseline scan or after the newest scan", () => {
    const out = deriveDeployAnnotations(SCANS, [
      dep("2026-08-20T00:00:00.000Z"), // before s1: no predecessor window
      dep("2026-09-22T00:00:00.000Z"), // after s3: no scan has measured it yet
    ]);
    expect(out).toEqual([]);
  });

  it("folds several deploys into one marker per scan, newest-first, with the failure count", () => {
    const out = deriveDeployAnnotations(SCANS, [
      dep("2026-09-12T00:00:00.000Z", "success", "d".repeat(40), "staging"),
      dep("2026-09-18T00:00:00.000Z", "error"),
      dep("2026-09-05T00:00:00.000Z", "success"),
    ]);
    expect(out.map((a) => [a.scanId, a.label])).toEqual([
      ["s3", "1 failed"],
      ["s2", "deploy"],
    ]);
    expect(out[0]!.deploys).toEqual({ count: 2, failed: 1, environments: ["production", "staging"] });
    // Newest deploy first inside the sentence.
    expect(out[0]!.detail.indexOf("error")).toBeLessThan(out[0]!.detail.indexOf("staging success"));
  });

  it("labels a clean multi-deploy scan with its count", () => {
    const out = deriveDeployAnnotations(SCANS, [dep("2026-09-12T00:00:00.000Z"), dep("2026-09-14T00:00:00.000Z")]);
    expect(out[0]!.label).toBe("2 deploys");
  });

  it("bounds the detail sentence and says how many it left out", () => {
    // MAX + 3 deploys, one per hour, all inside the s2 → s3 window.
    const many = Array.from({ length: MAX_DEPLOYS_IN_DETAIL + 3 }, (_, i) =>
      dep(new Date(Date.parse("2026-09-12T00:00:00.000Z") + i * 3_600_000).toISOString()),
    );
    const out = deriveDeployAnnotations(SCANS, many);
    expect(out).toHaveLength(1);
    expect(out[0]!.deploys!.count).toBe(MAX_DEPLOYS_IN_DETAIL + 3);
    expect(out[0]!.detail).toContain("and 3 more");
    expect(out[0]!.detail.match(/production success/g)).toHaveLength(MAX_DEPLOYS_IN_DETAIL);
  });

  it("never pins to a compacted period, and ignores an unparseable deploy time", () => {
    const withTail: HistoryPoint[] = [
      ...SCANS,
      { ...pt("digest:d1", "2026-08-01T00:00:00.000Z", 50), compacted: true, scanCount: 4 },
    ];
    const out = deriveDeployAnnotations(withTail, [dep("2026-08-15T00:00:00.000Z"), dep("garbage")]);
    expect(out).toEqual([]);
  });
});

describe("mergeTimelineEvents", () => {
  it("interleaves score events and deploy markers newest-first, score event first on a shared scan", () => {
    const scoreEvents = deriveTrendAnnotations(SCANS); // s3 is a -6 regression
    const deploys = deriveDeployAnnotations(SCANS, [dep("2026-09-15T00:00:00.000Z"), dep("2026-09-05T00:00:00.000Z")]);
    const merged = mergeTimelineEvents(scoreEvents, deploys);
    expect(merged.map((a) => `${a.kind}:${a.scanId}`)).toEqual(["regression:s3", "deploy:s3", "deploy:s2"]);
  });
});
