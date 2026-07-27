// Pure tests for the adoption→outcome pairing: picking the right before/after scans around an adoption
// instant, and — the contract that matters — returning HONEST NULLS instead of a fabricated delta when
// either side of the pair is missing.

import { describe, it, expect, vi } from "vitest";

const { mockHistory, mockAdoptions } = vi.hoisted(() => ({ mockHistory: vi.fn(), mockAdoptions: vi.fn() }));
vi.mock("@/lib/db", () => ({ getRepositoryHistory: mockHistory, listOrgSkillAdoptionRows: mockAdoptions }));

import { getOrgSkillOutcomes } from "./skill-outcomes-load";
import {
  measuredOutcomes,
  outcomeStatusLabel,
  pairScansAroundAdoption,
  skillOutcomeFor,
  skillOutcomesFor,
  type OutcomeScan,
} from "./skill-outcomes";

const scan = (id: string, day: string, overall: number, dims?: Record<string, number>): OutcomeScan => ({
  id,
  scannedAt: `2026-0${day}T00:00:00.000Z`,
  overallScore: overall,
  dimensions: dims ? Object.entries(dims).map(([dimId, score]) => ({ dimId, score })) : undefined,
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
    const labels = ["measured", "no-before-scan", "no-after-scan"] as const;
    expect(new Set(labels.map(outcomeStatusLabel)).size).toBe(3);
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
    expect(out.s1[0].overallDelta).toBe(6);
    expect(out.s2[0].overallDelta).toBe(6);
  });

  it("returns {} when nothing has been adopted", async () => {
    mockAdoptions.mockResolvedValueOnce([]);
    expect(await getOrgSkillOutcomes("acme")).toEqual({});
  });
});
