// Contract tests for the PURE exemplar diff (moonshot #34).
//
// Three guards carry a fail-before, recorded in the lane handoff:
//  1. "never fabricates a score gap" — coerce a missing side to 0 in diffAcrossRepos and it goes red.
//  2. "a single-tenant cohort never forms" — drop COHORT_MIN_ORGS and the 5-repos-from-2-orgs case
//     passes, which IS the cross-tenant leak this item exists to prevent.
//  3. "a cohort names no repo" — attribute the decile's best repo onto the profile and it goes red.

import { describe, it, expect } from "vitest";
import {
  buildCohortProfile,
  COHORT_MIN_ORGS,
  decileSize,
  diffAcrossRepos,
  exemplarRefLabel,
  formatExemplarRef,
  parseExemplarRef,
  repoProfile,
  selectOrgBest,
  transferJoin,
  type CohortMember,
  type ExemplarProfile,
  type ExemplarRef,
} from "./exemplar";
import type { ComparableDimension, ComparableScan } from "@/lib/db/scans";
import type { MinedPractice } from "@/lib/org/practice-mining";

function dim(
  dimId: string,
  o: { score?: number; signalScore?: number; evidence?: string[]; gaps?: string[] } = {},
): ComparableDimension {
  return {
    dimId,
    name: `${dimId} name`,
    score: o.score ?? 50,
    signalScore: o.signalScore ?? o.score ?? 50,
    evidence: o.evidence ?? [],
    gaps: o.gaps ?? [],
  };
}

function scan(dimensions: ComparableDimension[], overallScore = 50): ComparableScan {
  return {
    id: "scan-subject",
    scannedAt: "2026-08-01T00:00:00.000Z",
    overallScore,
    level: "L3",
    levelName: "Established",
    archetype: "team",
    adoptionScore: 50,
    rigorScore: 50,
    posture: "balanced",
    confidence: 0.8,
    engineProvider: "claude-cli",
    engineModel: "sonnet",
    headSha: null,
    dimensions,
    recommendations: [],
  };
}

function profile(dimensions: ComparableDimension[], over: Partial<ExemplarProfile> = {}): ExemplarProfile {
  return {
    key: "repo:acme/web",
    kind: "repo",
    label: "acme/web",
    repoFullName: "acme/web",
    scannedAt: "2026-08-02T00:00:00.000Z",
    overallScore: 70,
    dimensions,
    population: null,
    basis: { rubric: "r10", excludesMockEngine: true, minSupport: null },
    ...over,
  };
}

// ── Ref grammar ─────────────────────────────────────────────────────────────────────────────────

describe("parseExemplarRef / formatExemplarRef", () => {
  const cases: [string, ExemplarRef, string][] = [
    ["repo:acme/web", { kind: "repo", owner: "acme", name: "web" }, "repo:acme/web"],
    ["acme/web", { kind: "repo", owner: "acme", name: "web" }, "repo:acme/web"],
    ["org:best", { kind: "org-best", dimId: null }, "org:best"],
    ["org:best:D2", { kind: "org-best", dimId: "D2" }, "org:best:D2"],
    ["cohort:lang:TypeScript", { kind: "cohort", by: "lang", value: "TypeScript" }, "cohort:lang:TypeScript"],
    ["cohort:archetype:team", { kind: "cohort", by: "archetype", value: "team" }, "cohort:archetype:team"],
  ];
  it.each(cases)("parses %s and round-trips to the canonical token", (raw, want, canonical) => {
    const ref = parseExemplarRef(raw);
    expect(ref).toEqual(want);
    expect(formatExemplarRef(ref!)).toBe(canonical);
    // Canonical form re-parses to itself — what keeps a shared compare URL stable.
    expect(parseExemplarRef(canonical)).toEqual(want);
  });

  it.each([
    [""],
    ["   "],
    ["repo:acme"],
    ["acme/web/extra"],
    ["org:best:D99"],
    ["org:worst"],
    ["cohort:lang:"],
    ["cohort:archetype:everyone"],
    ["cohort:size:big"],
    ["repo:../etc/passwd"],
    ["acme/web?x=1"],
  ])("rejects %j rather than guessing", (raw) => {
    expect(parseExemplarRef(raw)).toBeNull();
  });

  it("labels each mode for the picker and the notices", () => {
    expect(exemplarRefLabel({ kind: "repo", owner: "a", name: "b" })).toBe("a/b");
    expect(exemplarRefLabel({ kind: "org-best", dimId: "D2" })).toBe("best in org for D2");
    expect(exemplarRefLabel({ kind: "org-best", dimId: null })).toBe("best in org overall");
    expect(exemplarRefLabel({ kind: "cohort", by: "lang", value: "Go" })).toBe("Go · top decile");
  });
});

// ── diffAcrossRepos ─────────────────────────────────────────────────────────────────────────────

describe("diffAcrossRepos", () => {
  it("splits evidence into absent (transfer list) and ahead (the other direction)", () => {
    const d = diffAcrossRepos(
      scan([dim("D2", { score: 40, evidence: ["Found 6 test files", "Snapshot suite present"] })]),
      profile([dim("D2", { score: 54, evidence: ["found 6   TEST files", "Coverage tracking configured"] })]),
    );
    const d2 = d.dimensions.find((x) => x.id === "D2")!;
    expect(d2.absentSignals).toEqual(["Coverage tracking configured"]);
    expect(d2.aheadSignals).toEqual(["Snapshot suite present"]);
    expect(d2.scoreGap).toBe(14);
    expect(d2.transferLine).toBe("D2 +14: exemplar has Coverage tracking configured");
    expect(d.absentSignalCount).toBe(1);
    expect(d.aheadSignalCount).toBe(1);
    expect(d.nothingToTransfer).toBe(false);
  });

  // FAIL-BEFORE: coerce a missing side to 0 (scoreGap = (theirs?.score ?? 0) - (mine?.score ?? 0))
  // and this goes red — the diff would then claim a −70 regression on a dimension nobody measured.
  it("never fabricates a score gap for a one-sided dimension", () => {
    const d = diffAcrossRepos(scan([dim("D1", { score: 70 })]), profile([dim("D2", { score: 60 })]));
    expect(d.notComparable).toEqual(["D1", "D2"]);
    for (const row of d.dimensions) {
      expect(row.scoreGap).toBeNull();
      expect(row.signalGap).toBeNull();
      expect(row.comparable).toBe(false);
      expect(row.absentSignals).toEqual([]);
      expect(row.aheadSignals).toEqual([]);
    }
    expect(d.absentSignalCount).toBe(0);
    expect(d.aheadSignalCount).toBe(0);
  });

  it("keeps the subject's own score and reports nothingToTransfer honestly", () => {
    const shared = [dim("D3", { score: 60, evidence: ["CI runs tests"] })];
    const d = diffAcrossRepos(scan(shared, 61), profile([dim("D3", { score: 60, evidence: ["ci runs tests"] })]));
    expect(d.nothingToTransfer).toBe(true);
    expect(d.dimensions[0]!.transferLine).toBeNull();
    expect(d.overallGap).toBe(9); // 70 − 61, both sides real
    expect(d.subject.overallScore).toBe(61);
  });

  it("carries an ineligible subject in the basis rather than hiding the comparison", () => {
    const d = diffAcrossRepos(scan([dim("D1")]), profile([dim("D1")]), { subjectEligible: false });
    expect(d.basis.subjectEligible).toBe(false);
    expect(d.basis.rubric).toBe("r10");
    expect(d.basis.excludesMockEngine).toBe(true);
  });

  it("emits a null overall gap when the exemplar has no overall score", () => {
    const d = diffAcrossRepos(scan([dim("D1")]), profile([dim("D1")], { overallScore: null }));
    expect(d.overallGap).toBeNull();
  });
});

// ── selectOrgBest ───────────────────────────────────────────────────────────────────────────────

describe("selectOrgBest", () => {
  const candidates = [
    { repoFullName: "acme/api", scannedAt: "2026-08-01T00:00:00.000Z", overallScore: 80, dimensions: [dim("D2", { signalScore: 40 })] },
    { repoFullName: "acme/web", scannedAt: "2026-08-01T00:00:00.000Z", overallScore: 55, dimensions: [dim("D2", { signalScore: 90 })] },
    { repoFullName: "acme/self", scannedAt: "2026-08-01T00:00:00.000Z", overallScore: 99, dimensions: [dim("D2", { signalScore: 99 })] },
  ];

  it("ranks by signalScore on the named dimension and excludes the subject repo", () => {
    const p = selectOrgBest(candidates, { dimId: "D2", excludeFullName: "acme/self" })!;
    expect(p.repoFullName).toBe("acme/web");
    expect(p.key).toBe("org:best:D2");
    expect(p.label).toContain("best in org for D2");
    expect(p.population).toBeNull();
  });

  it("ranks by overall score for the bare org:best ref", () => {
    const p = selectOrgBest(candidates, { dimId: null, excludeFullName: "acme/self" })!;
    expect(p.repoFullName).toBe("acme/api");
    expect(p.key).toBe("org:best");
  });

  it("skips a repo that did not score the requested dimension rather than ranking it at zero", () => {
    const p = selectOrgBest(
      [
        { repoFullName: "acme/api", scannedAt: "2026-08-01T00:00:00.000Z", overallScore: 90, dimensions: [] },
        { repoFullName: "acme/web", scannedAt: "2026-08-01T00:00:00.000Z", overallScore: 10, dimensions: [dim("D5", { signalScore: 12 })] },
      ],
      { dimId: "D5", excludeFullName: "" },
    )!;
    expect(p.repoFullName).toBe("acme/web");
  });

  it("returns null when the subject repo is the only candidate", () => {
    expect(selectOrgBest([candidates[2]!], { dimId: null, excludeFullName: "acme/self" })).toBeNull();
  });
});

describe("repoProfile", () => {
  it("wraps a named peer scan in the SAME profile shape as the other two modes", () => {
    const p = repoProfile(
      { kind: "repo", owner: "acme", name: "api" },
      { repoFullName: "acme/api", scannedAt: "2026-08-03T00:00:00.000Z", overallScore: 72, dimensions: [dim("D1")] },
    );
    expect(p).toMatchObject({ key: "repo:acme/api", kind: "repo", label: "acme/api", population: null });
    expect(p.basis.minSupport).toBeNull();
  });
});

// ── buildCohortProfile ──────────────────────────────────────────────────────────────────────────

function member(orgId: string, n: string, overallScore: number, evidence: string[]): CohortMember {
  return { orgId, repoFullName: `${orgId}/${n}`, overallScore, dimensions: [dim("D2", { score: overallScore, evidence })] };
}

describe("buildCohortProfile", () => {
  const cohortRef: ExemplarRef = { kind: "cohort", by: "lang", value: "TypeScript" };
  const ref = cohortRef as Extract<ExemplarRef, { kind: "cohort" }>;

  it("refuses a 4-repo cohort — below the repo floor", () => {
    const out = buildCohortProfile(
      ["o1", "o2", "o3", "o4"].map((o, i) => member(o, "r", 60 + i, ["x"])),
      ref,
    );
    expect(out).toEqual({ kind: "below-floor", population: 4, min: 5 });
  });

  // FAIL-BEFORE: delete the COHORT_MIN_ORGS check and this case returns kind:"ok" — five public repos
  // belonging to two tenants become "the cohort", i.e. a de-facto view of those two tenants.
  it("refuses 5 repos from 2 orgs — the single-tenant-cohort leak", () => {
    const out = buildCohortProfile(
      [
        member("o1", "a", 90, ["x"]),
        member("o1", "b", 88, ["x"]),
        member("o1", "c", 86, ["x"]),
        member("o2", "d", 84, ["x"]),
        member("o2", "e", 82, ["x"]),
      ],
      ref,
    );
    expect(out).toEqual({ kind: "below-floor", population: 2, min: COHORT_MIN_ORGS });
  });

  it("builds a profile at 5 repos from 3 orgs, aggregate-only", () => {
    const members = [
      member("o1", "a", 90, ["Coverage tracking configured", "Only mine"]),
      member("o2", "b", 88, ["coverage tracking configured"]),
      member("o3", "c", 86, ["Coverage tracking configured"]),
      member("o1", "d", 40, ["ignored — outside the decile"]),
      member("o2", "e", 30, ["ignored — outside the decile"]),
    ];
    const out = buildCohortProfile(members, ref);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const p = out.profile;
    expect(p.repoFullName).toBeNull();
    expect(p.scannedAt).toBeNull();
    expect(p.population).toBe(5);
    expect(p.key).toBe("cohort:lang:TypeScript");
    // FAIL-BEFORE for aggregate-only: attribute the decile's best repo onto `repoFullName` (or leak
    // it into `label`) and this assertion goes red. No `owner/name` shape may appear anywhere.
    expect(JSON.stringify(p)).not.toMatch(/o\d\/[a-e]/);
    // Support = ceil(3 * 2/3) = 2: the signal 3 repos carry survives, the 1-of-3 signal does not.
    expect(p.basis.minSupport).toBe(2);
    const d2 = p.dimensions.find((d) => d.dimId === "D2")!;
    expect(d2.evidence).toEqual(["Coverage tracking configured"]);
    expect(d2.score).toBe(88); // median of the decile's 90 / 88 / 86
  });

  it("omits a dimension the decile never scored rather than scoring it zero", () => {
    const members = ["o1", "o2", "o3", "o4", "o5"].map((o, i) => member(o, "r", 90 - i, ["x", "x"]));
    const out = buildCohortProfile(members, ref);
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.profile.dimensions.map((d) => d.dimId)).toEqual(["D2"]);
  });
});

describe("decileSize", () => {
  it("floors at 3 so a small cohort's 'top decile' is never one repo", () => {
    expect(decileSize(5)).toBe(3);
    expect(decileSize(100)).toBe(10);
    expect(decileSize(2)).toBe(2);
  });
});

// ── transferJoin ────────────────────────────────────────────────────────────────────────────────

describe("transferJoin", () => {
  const diff = diffAcrossRepos(
    scan([dim("D2", { score: 40, evidence: [] }), dim("D5", { score: 40, evidence: [] })]),
    profile([
      dim("D2", { score: 60, evidence: ["Coverage tracking configured"] }),
      dim("D5", { score: 60, evidence: [] }),
    ]),
  );

  const mined: MinedPractice[] = [
    {
      practiceId: "test-discipline",
      label: "Test discipline",
      dimId: "D2",
      exemplars: ["acme/api", "acme/web"],
      gapRepos: ["acme/legacy"],
      outline: [{ text: "## Running the suite", agreement: 2 }],
      layout: [],
      offerable: true,
    },
  ];

  it("emits a row only for dimensions with something to transfer, joined to PRACTICES by dimension", () => {
    const rows = transferJoin(diff, mined, "acme");
    expect(rows.map((r) => r.dimId)).toEqual(["D2"]);
    expect(rows[0]!.practice).toEqual({
      id: "test-discipline",
      label: "Test discipline",
      what: "The guardrail that makes AI-generated changes safe to merge.",
    });
    expect(rows[0]!.housePattern).toEqual({ outline: ["Running the suite"], exemplars: 2 });
    expect(rows[0]!.applyHref).toContain("acme");
    expect(rows[0]!.skillsHref).toContain("acme");
  });

  it("offers no house pattern when the miner judged it un-offerable — the static starter still stands", () => {
    const rows = transferJoin(diff, [{ ...mined[0]!, offerable: false }], "acme");
    expect(rows[0]!.housePattern).toBeNull();
    expect(rows[0]!.practice).not.toBeNull();
  });

  it("dangles no link for a public-org viewer", () => {
    const rows = transferJoin(diff, mined, null);
    expect(rows[0]!.applyHref).toBeNull();
    expect(rows[0]!.skillsHref).toBeNull();
  });
});

// ── The match level (UAT `SAM-L1-10`) ───────────────────────────────────────────────────────────
//
// Exact normalized string equality is right for one repo against its own earlier scan and wrong
// ACROSS repos: two projects never write a detector's count the same way. FAIL-BEFORE for all of
// these — swap `diffSignalSets` back to `diffStringSets` in exemplar.ts and they go red.

describe("diffAcrossRepos — evidence is matched at the SIGNAL level, displayed raw", () => {
  it("does not call a signal absent when the subject has it with a different count", () => {
    const d = diffAcrossRepos(
      scan([dim("D2", { score: 40, evidence: ["Found 6 test files"] })]),
      profile([dim("D2", { score: 54, evidence: ["Found 214 test files"] })]),
    );
    const d2 = d.dimensions.find((x) => x.id === "D2")!;
    // The wrong transfer recommendation: "they have a test framework, you do not", to a repo with one.
    expect(d2.absentSignals).toEqual([]);
    expect(d2.aheadSignals).toEqual([]);
    expect(d.nothingToTransfer).toBe(true);
  });

  it("never lands one count-bearing signal in BOTH directions of the diff", () => {
    const d = diffAcrossRepos(
      scan([dim("D3", { evidence: ["CI workflows: 3 of 3 pinned"] })]),
      profile([dim("D3", { evidence: ["CI workflows: 9 of 9 pinned"] })]),
    );
    const d3 = d.dimensions.find((x) => x.id === "D3")!;
    expect(d3.absentSignals.length + d3.aheadSignals.length).toBe(0);
  });

  it("keeps a genuinely different signal, and displays the EXEMPLAR's own wording for it", () => {
    const d = diffAcrossRepos(
      scan([dim("D2", { evidence: ["Found 6 test files"] })]),
      profile([dim("D2", { evidence: ["Found 214 test files", "Coverage tracking configured (87%)"] })]),
    );
    const d2 = d.dimensions.find((x) => x.id === "D2")!;
    expect(d2.absentSignals).toEqual(["Coverage tracking configured (87%)"]);
  });

  it("matches GAPS at the same level, so a shared gap is not reported as the subject's alone", () => {
    const d = diffAcrossRepos(
      scan([dim("D2", { gaps: ["Only 2 of 9 modules covered"] })]),
      profile([dim("D2", { gaps: ["Only 41 of 60 modules covered"] })]),
    );
    expect(d.dimensions.find((x) => x.id === "D2")!.gapsOnlyInSubject).toEqual([]);
  });
});

describe("buildCohortProfile — consensus survives per-repo counts", () => {
  const member = (orgId: string, repoFullName: string, n: number): CohortMember => ({
    orgId,
    repoFullName,
    overallScore: 80,
    dimensions: [dim("D2", { score: 80, evidence: [`Found ${n} test files`] })],
  });

  it("reaches consensus on one signal every member phrases with its own count", () => {
    // Each member writes a different number. Under string equality every phrasing had support 1,
    // cleared no threshold, and the dimension contributed NO evidence at all.
    const members = [
      member("o1", "one/a", 6),
      member("o1", "one/b", 12),
      member("o2", "two/c", 44),
      member("o3", "three/d", 91),
      member("o3", "three/e", 3),
    ];
    const out = buildCohortProfile(members, { kind: "cohort", by: "lang", value: "TypeScript" });
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") throw new Error("unreachable");
    const d2 = out.profile.dimensions.find((d) => d.dimId === "D2")!;
    expect(d2.evidence).toHaveLength(1);
    // One entry, carrying a real member's wording rather than a synthesised one.
    expect(d2.evidence[0]).toMatch(/^Found \d+ test files$/);
  });
});
