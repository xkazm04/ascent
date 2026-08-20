// Pure tests for the adoption→outcome pairing: picking the right before/after scans around an adoption
// instant, and — the contract that matters — returning HONEST NULLS instead of a fabricated delta when
// either side of the pair is missing.

import { describe, it, expect, vi } from "vitest";

const { mockHistory, mockAdoptions } = vi.hoisted(() => ({ mockHistory: vi.fn(), mockAdoptions: vi.fn() }));
vi.mock("@/lib/db", () => ({ getRepositoryHistory: mockHistory, listOrgSkillAdoptionRows: mockAdoptions }));

import { getOrgSkillOutcomes } from "./skill-outcomes-load";
import {
  aggregateOutcomes,
  coverageLabel,
  meanDeltaLine,
  measuredOutcomes,
  outcomeStatusLabel,
  pairScansAroundAdoption,
  PAIRING_MAX_DISTANCE_DAYS,
  skillOutcomeFor,
  skillOutcomesFor,
  type OutcomeScan,
} from "./skill-outcomes";

// Every fixture scan declares its instrument, because after D11 a scan that DOESN'T is not comparable
// with anything (see the "instrument identity" block below for the cases that exercise silence).
const scan = (
  id: string,
  day: string,
  overall: number,
  dims?: Record<string, number>,
  instrument?: Partial<Pick<OutcomeScan, "rubricVersion" | "engineProvider">>,
): OutcomeScan => ({
  id,
  scannedAt: `2026-0${day}T00:00:00.000Z`,
  overallScore: overall,
  dimensions: dims ? Object.entries(dims).map(([dimId, score]) => ({ dimId, score })) : undefined,
  rubricVersion: "r7",
  engineProvider: "anthropic",
  ...instrument,
});

const ADOPTED = "2026-04-10T00:00:00.000Z";
const adoption = { skillId: "s1", repoFullName: "acme/api", adoptedAt: ADOPTED };

describe("pairScansAroundAdoption", () => {
  const scans = [scan("s4", "6-01", 71), scan("s3", "4-20", 68), scan("s2", "4-01", 60), scan("s1", "1-05", 55)];

  it("picks the LATEST before and the LATEST after (input order irrelevant)", () => {
    const a = pairScansAroundAdoption(scans, ADOPTED);
    expect([a.before?.id, a.after?.id]).toEqual(["s2", "s4"]);
    const b = pairScansAroundAdoption([...scans].reverse(), ADOPTED);
    expect([b.before?.id, b.after?.id]).toEqual(["s2", "s4"]);
  });

  it("counts a scan at the exact adoption instant as AFTER", () => {
    const at = scan("exact", "4-10", 64);
    const { before, after } = pairScansAroundAdoption([scan("old", "4-01", 60), at], ADOPTED);
    expect(before?.id).toBe("old");
    expect(after?.id).toBe("exact");
  });

  it("returns nulls for an empty history or an unparseable adoption date", () => {
    expect(pairScansAroundAdoption([], ADOPTED)).toEqual({ before: null, after: null });
    expect(pairScansAroundAdoption(scans, "not-a-date")).toEqual({ before: null, after: null });
  });
});

describe("skillOutcomeFor", () => {
  it("measures the overall delta when both sides exist", () => {
    const o = skillOutcomeFor(adoption, [scan("b", "4-01", 60), scan("a", "5-01", 64)]);
    expect(o.status).toBe("measured");
    expect(o.overallDelta).toBe(4);
    expect(o.before?.id).toBe("b");
    expect(o.after?.id).toBe("a");
  });

  it("reports a NEGATIVE delta honestly (adoption is not assumed to help)", () => {
    const o = skillOutcomeFor(adoption, [scan("b", "4-01", 70), scan("a", "5-01", 63)]);
    expect(o.overallDelta).toBe(-7);
  });

  it("no-before-scan: never fabricates a delta from the after-scan alone", () => {
    const o = skillOutcomeFor(adoption, [scan("a", "5-01", 64)]);
    expect(o.status).toBe("no-before-scan");
    expect(o.overallDelta).toBeNull();
    expect(o.before).toBeNull();
    expect(o.dimensionDeltas).toEqual([]);
  });

  it("no-after-scan: an adoption not yet re-scanned yields null, not zero", () => {
    const o = skillOutcomeFor(adoption, [scan("b", "4-01", 60)]);
    expect(o.status).toBe("no-after-scan");
    expect(o.overallDelta).toBeNull();
    expect(o.after).toBeNull();
  });

  it("a never-scanned repo is no-before-scan, not a 0-point outcome", () => {
    const o = skillOutcomeFor(adoption, []);
    expect(o.status).toBe("no-before-scan");
    expect(o.overallDelta).toBeNull();
  });

  it("computes per-dimension deltas, biggest mover first, skipping one-sided dimensions", () => {
    const o = skillOutcomeFor(adoption, [
      scan("b", "4-01", 60, { D1: 50, D2: 40, D3: 30 }),
      scan("a", "5-01", 68, { D1: 52, D2: 60, D9: 10 }),
    ]);
    expect(o.dimensionDeltas).toEqual([
      { dimId: "D2", before: 40, after: 60, delta: 20 },
      { dimId: "D1", before: 50, after: 52, delta: 2 },
    ]);
  });
});

describe("skillOutcomesFor / measuredOutcomes", () => {
  const adoptions = [
    { skillId: "s1", repoFullName: "acme/api", adoptedAt: ADOPTED },
    { skillId: "s1", repoFullName: "acme/web", adoptedAt: ADOPTED },
    { skillId: "s2", repoFullName: "acme/api", adoptedAt: ADOPTED },
  ];
  const byRepo = new Map<string, OutcomeScan[]>([
    ["acme/api", [scan("b", "4-01", 60), scan("a", "5-01", 65)]],
    ["acme/web", [scan("only", "5-01", 40)]],
  ]);

  it("groups outcomes per skill and keeps the unmeasurable ones visible", () => {
    const out = skillOutcomesFor(adoptions, byRepo);
    expect(out.s1).toHaveLength(2);
    expect(out.s1.map((o) => o.status)).toEqual(["measured", "no-before-scan"]);
    expect(out.s2[0].overallDelta).toBe(5);
  });

  it("measuredOutcomes keeps only real pairs, best movement first", () => {
    const out = skillOutcomesFor(adoptions, byRepo);
    expect(measuredOutcomes(out.s1).map((o) => o.repoFullName)).toEqual(["acme/api"]);
    expect(measuredOutcomes(undefined)).toEqual([]);
  });

  it("labels each status distinctly", () => {
    const labels = ["measured", "no-before-scan", "no-after-scan", "instrument-mismatch", "instrument-unknown"] as const;
    expect(new Set(labels.map(outcomeStatusLabel)).size).toBe(5);
  });
});

// ── D11: the two sides must have been produced by the same instrument ────────────────────────────
describe("instrument identity", () => {
  it("REGRESSION: a rubric bump between the two scans never publishes a delta", () => {
    const o = skillOutcomeFor(adoption, [
      scan("b", "4-01", 60, { D1: 50 }, { rubricVersion: "r6" }),
      scan("a", "5-01", 68, { D1: 58 }, { rubricVersion: "r7" }),
    ]);
    // Before the fix this read "+8 since adoption" — some or all of it a re-weighting, not the practice.
    expect(o.status).toBe("instrument-mismatch");
    expect(o.overallDelta).toBeNull();
    expect(o.dimensionDeltas).toEqual([]);
    expect(outcomeStatusLabel(o.status)).toMatch(/not comparable/);
  });

  it("a different scoring engine is a mismatch too (mock floor vs a live model)", () => {
    const o = skillOutcomeFor(adoption, [
      scan("b", "4-01", 60, undefined, { engineProvider: "mock" }),
      scan("a", "5-01", 68, undefined, { engineProvider: "anthropic" }),
    ]);
    expect(o.status).toBe("instrument-mismatch");
    expect(o.overallDelta).toBeNull();
  });

  it("SILENCE IS NOT SAMENESS: an undeclared instrument on either side is `instrument-unknown`", () => {
    const undeclared = { rubricVersion: null, engineProvider: null };
    const beforeSilent = skillOutcomeFor(adoption, [scan("b", "4-01", 60, undefined, undeclared), scan("a", "5-01", 68)]);
    const afterSilent = skillOutcomeFor(adoption, [scan("b", "4-01", 60), scan("a", "5-01", 68, undefined, undeclared)]);
    const bothSilent = skillOutcomeFor(adoption, [
      scan("b", "4-01", 60, undefined, undeclared),
      scan("a", "5-01", 68, undefined, undeclared),
    ]);
    for (const o of [beforeSilent, afterSilent, bothSilent]) {
      expect(o.status).toBe("instrument-unknown");
      expect(o.overallDelta).toBeNull();
    }
  });

  it("a matching instrument measures, and travels with the outcome", () => {
    const o = skillOutcomeFor(adoption, [scan("b", "4-01", 60), scan("a", "5-01", 68)]);
    expect(o.status).toBe("measured");
    expect(o.overallDelta).toBe(8);
    expect(o.instrument).toEqual({ rubricVersion: "r7", engineProvider: "anthropic" });
  });
});

// ── D33: how far each side sits from the adoption instant ────────────────────────────────────────
describe("pairing distance", () => {
  it("carries both gaps and flags a pair that straddles the bound", () => {
    const far = skillOutcomeFor({ ...adoption, adoptedAt: "2026-06-10T00:00:00.000Z" }, [
      { id: "old", scannedAt: "2024-12-01T00:00:00.000Z", overallScore: 50, rubricVersion: "r7", engineProvider: "anthropic" },
      scan("a", "7-01", 70),
    ]);
    expect(far.beforeGapDays).toBeGreaterThan(PAIRING_MAX_DISTANCE_DAYS);
    expect(far.withinPairingBound).toBe(false);
    // Flagged, NOT filtered: the delta is still reported so the view does not empty overnight.
    expect(far.overallDelta).toBe(20);
  });

  it("a tight pair is within the bound, and the bound is overridable", () => {
    const o = skillOutcomeFor(adoption, [scan("b", "4-01", 60), scan("a", "4-20", 64)]);
    expect(o.withinPairingBound).toBe(true);
    expect([o.beforeGapDays, o.afterGapDays]).toEqual([9, 10]);
    expect(skillOutcomeFor(adoption, [scan("b", "4-01", 60), scan("a", "4-20", 64)], { maxPairingDistanceDays: 5 })
      .withinPairingBound).toBe(false);
  });

  it("leaves the flag null when there is no pair to measure", () => {
    expect(skillOutcomeFor(adoption, [scan("a", "5-01", 64)]).withinPairingBound).toBeNull();
  });
});

// ── D34: a mean delta may not travel without the population it excluded ──────────────────────────
describe("aggregateOutcomes", () => {
  const outcomes = () =>
    skillOutcomesFor(
      [
        { skillId: "s", repoFullName: "a", adoptedAt: ADOPTED },
        { skillId: "s", repoFullName: "b", adoptedAt: ADOPTED },
        { skillId: "s", repoFullName: "c", adoptedAt: ADOPTED },
        { skillId: "s", repoFullName: "d", adoptedAt: ADOPTED },
      ],
      new Map<string, OutcomeScan[]>([
        ["a", [scan("b1", "4-01", 60), scan("a1", "5-01", 66)]],
        ["b", [scan("b2", "4-01", 50), scan("a2", "5-01", 54)]],
        ["c", [scan("only", "5-01", 40)]], // no before
        ["d", [scan("b4", "4-01", 60), scan("a4", "5-01", 70, undefined, { rubricVersion: "r6" })]],
      ]),
    ).s!;

  it("reports the mean beside the population it could not measure", () => {
    const agg = aggregateOutcomes(outcomes());
    expect(agg.meanDelta).toBe(5);
    expect([agg.measured, agg.unpaired, agg.total]).toEqual([2, 2, 4]);
    expect(agg.byStatus["no-before-scan"]).toBe(1);
    expect(agg.byStatus["instrument-mismatch"]).toBe(1);
  });

  it("the coverage sentence names every excluded group", () => {
    const line = coverageLabel(aggregateOutcomes(outcomes()));
    expect(line).toContain("2 of 4 adoptions measured");
    expect(line).toContain("1 with no scan before it");
    expect(line).toContain("1 not comparable");
  });

  it("meanDeltaLine cannot render the number without the coverage", () => {
    expect(meanDeltaLine(aggregateOutcomes(outcomes()))).toBe(
      "+5 pts mean · 2 of 4 adoptions measured — 1 with no scan before it, 1 not comparable across rubric versions",
    );
  });

  it("null mean — never 0 — when nothing is comparable", () => {
    const agg = aggregateOutcomes([]);
    expect(agg.meanDelta).toBeNull();
    expect(meanDeltaLine(agg)).toBe("No comparable before/after pair · No adoptions to measure yet");
  });
});

describe("getOrgSkillOutcomes", () => {
  it("reads history once per DISTINCT repo and folds the result", async () => {
    mockAdoptions.mockResolvedValueOnce([
      { skillId: "s1", repoFullName: "acme/api", adoptedAt: ADOPTED },
      { skillId: "s2", repoFullName: "acme/api", adoptedAt: ADOPTED },
    ]);
    mockHistory.mockResolvedValue({
      repo: { owner: "acme", name: "api", fullName: "acme/api" },
      scans: [
        { id: "a", scannedAt: "2026-05-01T00:00:00.000Z", overallScore: 66, dimensions: [] },
        { id: "b", scannedAt: "2026-04-01T00:00:00.000Z", overallScore: 60, dimensions: [] },
      ],
    });
    const out = await getOrgSkillOutcomes("acme");
    expect(mockHistory).toHaveBeenCalledTimes(1);
    // The fold still runs once per distinct repo and pairs both adoptions…
    expect(out.s1[0].before?.id).toBe("b");
    expect(out.s1[0].after?.id).toBe("a");
    // …but a HistoryPoint carries no `rubricVersion` today, so the pair is honestly NOT COMPARABLE.
    // This is the D11 contract, and it pins the remaining wiring: once HistoryPoint carries the scan's
    // rubric version (Scan.rubricVersion is already persisted — prisma/schema.prisma) and
    // skill-outcomes-load's toOutcomeScan passes it through, these become `measured` again. Until then,
    // no number is published for a pair whose comparability nobody can assert.
    expect(out.s1[0].status).toBe("instrument-unknown");
    expect(out.s1[0].overallDelta).toBeNull();
    expect(out.s2[0].overallDelta).toBeNull();
  });

  it("returns {} when nothing has been adopted", async () => {
    mockAdoptions.mockResolvedValueOnce([]);
    expect(await getOrgSkillOutcomes("acme")).toEqual({});
  });
});
