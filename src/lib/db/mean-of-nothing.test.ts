// The mean of nothing is NULL, at every producer that publishes one.
//
// `roundedMean` returned 0 for an empty list and its docstring called that "always empty-guarded, so
// copies that omitted the guard are corrected by routing through here" — which standardised the wrong
// answer at 15 call sites. A 0 is indistinguishable from a measured 0, and downstream that is not
// cosmetic: `scoreHex(0)` is alarm red, `postureFor(0, 0)` classifies a segment nobody scanned into a
// real quadrant, and a sort on the value ranks the unmeasured BELOW every measurement instead of
// outside them. The /org UX redesign found the same defect on eight surfaces across seven tabs.
//
// Every case below is a pair: an EMPTY population must yield null, and a population MEASURED AT ZERO
// must yield 0 — and the two must be distinguishable. A test that only checked the empty case would
// pass against a producer that had simply stopped emitting scores at all.
//
// Consumer-side pins for the same contract live beside their surfaces (overviewStanding.test.ts,
// segmentViz.test.ts, stackMeasure.test.ts, briefing.test.ts, digest.test.ts, teamRollup.test.ts).

import { describe, it, expect, vi } from "vitest";

const { mockGetPrisma, mockIsDbConfigured } = vi.hoisted(() => ({
  mockGetPrisma: vi.fn(),
  mockIsDbConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: mockIsDbConfigured }));

import { hasFleetGrade, mean, roundedMean } from "@/lib/db/org-shared";
import { buildSegmentComparison, summarizeScopedRepos } from "@/lib/db/segments";
import { computeCohortMovement, type OrgRepoRow, type RepoScoreSnap } from "@/lib/db/org-rollup";
import { rollupTeams, type TeamRollupRepoInput } from "@/lib/db/org-teams";
import { explainTeamStandings } from "@/lib/org/teamStandings";

/** A rollup row carrying one latest scan — only `latest` is read by `summarizeScopedRepos`. */
const repoRow = (fullName: string, latest: { overall: number; adoption: number; rigor: number } | null): OrgRepoRow =>
  ({
    fullName,
    latest: latest && {
      level: "L2",
      overall: latest.overall,
      adoption: latest.adoption,
      rigor: latest.rigor,
      posture: "pragmatist",
      scannedAt: "2026-09-01T00:00:00.000Z",
      engine: "claude",
      dims: [{ dimId: "D1", score: latest.overall }],
    },
  }) as unknown as OrgRepoRow;

const snap = (repoId: string, overall: number): RepoScoreSnap => ({ repoId, overall, adoption: overall, rigor: overall });

describe("mean / roundedMean — the primitive", () => {
  it("returns null for an empty list and 0 for a list measured at zero", () => {
    expect(mean([])).toBeNull();
    expect(roundedMean([])).toBeNull();
    expect(mean([0, 0, 0])).toBe(0);
    expect(roundedMean([0, 0, 0])).toBe(0);
    // The whole point: the two answers are not the same value.
    expect(roundedMean([])).not.toBe(roundedMean([0]));
  });

  it("never returns NaN for an empty list", () => {
    expect(Number.isNaN(mean([] as number[]) as unknown as number)).toBe(false);
  });

  it("still rounds a real mean", () => {
    expect(roundedMean([70, 71])).toBe(71);
    expect(roundedMean([0, 1])).toBe(1); // Math.round(0.5)
  });
});

describe("hasFleetGrade — the narrowing gate", () => {
  const graded = { avgOverall: 0, avgAdoption: 0, avgRigor: 0 };
  it("passes a fleet measured at zero and refuses one that was never measured", () => {
    expect(hasFleetGrade(graded)).toBe(true);
    expect(hasFleetGrade({ avgOverall: null, avgAdoption: null, avgRigor: null })).toBe(false);
  });

  it("refuses a HALF-graded scope — the three averages share one population", () => {
    expect(hasFleetGrade({ ...graded, avgRigor: null })).toBe(false);
  });

  it("refuses an undefined the type says cannot happen (a hand-built row)", () => {
    expect(hasFleetGrade({ avgOverall: 62, avgAdoption: undefined, avgRigor: 70 } as never)).toBe(false);
  });
});

describe("summarizeScopedRepos — a scope with nothing scanned has no averages AND no posture", () => {
  it("yields null averages and a null posture for an empty scope", () => {
    const s = summarizeScopedRepos({ id: "seg", name: "New" }, []);
    expect(s.scannedCount).toBe(0);
    expect(s.avgOverall).toBeNull();
    expect(s.avgAdoption).toBeNull();
    expect(s.avgRigor).toBeNull();
    // The categorical is the worst of the eight: `postureFor(0, 0)` returned a REAL quadrant id, and
    // the Segments strip drew it as a labelled, coloured classification of a scope nobody looked at.
    expect(s.posture).toBeNull();
  });

  it("yields null averages for a scope whose repos exist but were never scanned", () => {
    const s = summarizeScopedRepos({ id: "seg", name: "Tagged" }, [repoRow("a/x", null), repoRow("a/y", null)]);
    expect(s.repoCount).toBe(2);
    expect(s.scannedCount).toBe(0);
    expect(s.avgOverall).toBeNull();
    expect(s.posture).toBeNull();
  });

  it("keeps a scope MEASURED at zero fully scored, posture included", () => {
    const s = summarizeScopedRepos({ id: "seg", name: "Floor" }, [repoRow("a/x", { overall: 0, adoption: 0, rigor: 0 })]);
    expect(s.scannedCount).toBe(1);
    expect(s.avgOverall).toBe(0);
    expect(s.avgAdoption).toBe(0);
    expect(s.avgRigor).toBe(0);
    expect(s.posture).not.toBeNull();
  });

  it("is unchanged for an ordinary measured scope", () => {
    const s = summarizeScopedRepos({ id: "seg", name: "Platform" }, [
      repoRow("a/x", { overall: 80, adoption: 70, rigor: 90 }),
      repoRow("a/y", { overall: 60, adoption: 50, rigor: 70 }),
    ]);
    expect(s.avgOverall).toBe(70);
    expect(s.avgAdoption).toBe(60);
    expect(s.avgRigor).toBe(80);
    expect(s.posture).not.toBeNull();
  });
});

describe("buildSegmentComparison — a delta needs a number on BOTH ends", () => {
  const a = summarizeScopedRepos({ id: "a", name: "A" }, [repoRow("a/x", { overall: 80, adoption: 70, rigor: 90 })]);
  const empty = summarizeScopedRepos({ id: "b", name: "B" }, []);
  const floor = summarizeScopedRepos({ id: "c", name: "C" }, [repoRow("a/z", { overall: 0, adoption: 0, rigor: 0 })]);

  it("withholds every headline delta when one side was never measured", () => {
    const cmp = buildSegmentComparison(a, empty);
    expect(cmp.deltas.overall).toBeNull();
    expect(cmp.deltas.adoption).toBeNull();
    expect(cmp.deltas.rigor).toBeNull();
  });

  it("still reports the full gap against a side MEASURED at zero", () => {
    // 80 − nothing is not 80; 80 − 0 is. This pair is why the distinction has to exist.
    expect(buildSegmentComparison(a, floor).deltas.overall).toBe(80);
    expect(buildSegmentComparison(a, empty).deltas.overall).toBeNull();
  });
});

describe("computeCohortMovement — no cohort, no movement", () => {
  it("returns null when the windows do not overlap", () => {
    expect(computeCohortMovement([snap("r1", 70)], [snap("r2", 60)])).toBeNull();
    expect(computeCohortMovement([], [])).toBeNull();
  });

  it("reports a real delta over the matched cohort, including a move TO zero", () => {
    const m = computeCohortMovement([snap("r1", 0)], [snap("r1", 40)])!;
    expect(m).not.toBeNull();
    expect(m.overall).toBe(-40);
    expect(m.cohortSize).toBe(1);
  });
});

describe("rollupTeams / explainTeamStandings — a team's grade is over its live-scored repos", () => {
  const teamRepo = (fullName: string, overall: number, engineProvider: string): TeamRollupRepoInput => ({
    fullName,
    name: fullName.split("/")[1]!,
    teams: [{ slug: "@acme/core", ownedPaths: 1, isDefaultOwner: true }],
    scans: [
      {
        overallScore: overall,
        adoptionScore: overall,
        rigorScore: overall,
        level: "L2",
        posture: "pragmatist",
        engineProvider,
        dimensions: [{ dimId: "D1", score: overall }],
      },
    ],
    contributors: [],
  });

  it("emits no team at all when every owned repo sits on the mock floor", () => {
    // The rule used to be a `.filter(t => t.realScoredCount > 0)` applied AFTER the row was built,
    // which meant the row had to be constructible — and `roundedMean` had to invent a 0 to make it so.
    const out = rollupTeams("acme", [teamRepo("acme/a", 55, "mock"), teamRepo("acme/b", 55, "mock")]);
    expect(out.teams).toEqual([]);
  });

  it("emits a team measured at zero WITH its grade", () => {
    const out = rollupTeams("acme", [teamRepo("acme/a", 0, "claude")]);
    expect(out.teams).toHaveLength(1);
    expect(out.teams[0]!.avgOverall).toBe(0);
    expect(out.teams[0]!.posture).toBeTruthy();
  });

  it("refuses a standings explanation when no live-scored repo is attributed to any team", () => {
    const mockOnly = rollupTeams("acme", [
      { ...teamRepo("acme/a", 55, "mock"), teams: [{ slug: "@acme/a", ownedPaths: 1, isDefaultOwner: true }] },
      { ...teamRepo("acme/b", 55, "mock"), teams: [{ slug: "@acme/b", ownedPaths: 1, isDefaultOwner: true }] },
    ]);
    // Nothing to contrast (rollupTeams emitted no team), and nothing to diverge FROM either.
    expect(explainTeamStandings(mockOnly.teams)).toBeNull();
  });

  it("explains the standings when there is a fleet mean to diverge from", () => {
    const live = rollupTeams("acme", [
      { ...teamRepo("acme/a", 80, "claude"), teams: [{ slug: "@acme/a", ownedPaths: 1, isDefaultOwner: true }] },
      { ...teamRepo("acme/b", 40, "claude"), teams: [{ slug: "@acme/b", ownedPaths: 1, isDefaultOwner: true }] },
    ]);
    const s = explainTeamStandings(live.teams)!;
    expect(s).not.toBeNull();
    expect(s.fleetAvgOverall).toBe(60);
    expect(s.spread).toBe(40);
  });
});
