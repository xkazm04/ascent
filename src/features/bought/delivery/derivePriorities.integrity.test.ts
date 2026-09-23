// "Fix first" used to give an all-clear over any fleet at 80%+ review coverage, although the same
// scans counted how many of those approvals landed within five minutes of the PR opening. This pins
// the one question that closes that gap, phrased about a repository's approvals, never a reviewer.

import { describe, expect, it } from "vitest";
import { derivePriorities } from "./derivePriorities";
import type { OrgGovernance, OrgPrSignals, PrRepoRow } from "@/lib/db";
import type { FleetRateId } from "@/lib/db/org-signals";

type Counts = { count: number; population: number } | null;

const repo = (name: string, fastApproval: Counts, over: Partial<PrRepoRow> = {}): PrRepoRow => ({
  fullName: `acme/${name}`,
  name,
  analyzed: 40,
  mergeRate: 90,
  reviewedRate: 95,
  smallPrRate: 60,
  aiInvolvedRate: 20,
  aiGovernedRate: 90,
  medianHoursToMerge: 4,
  revertRate: 1,
  medianHoursToFirstReview: 2,
  aiTrailerRate: 10,
  aiPreReviewedRate: 5,
  population: { revert: 40, reviewed: 30, aiGoverned: 8, merge: 38, smallPr: 40, aiInvolved: 40 },
  integrity: { selfApproved: { count: 0, population: 10 }, fastApproval },
  ...over,
});

const basis = (): Record<FleetRateId, { weight: number; repos: number; population: number | null }> => ({
  merge: { weight: 40, repos: 1, population: 38 },
  reviewed: { weight: 40, repos: 1, population: 30 },
  smallPr: { weight: 40, repos: 1, population: 40 },
  aiInvolved: { weight: 40, repos: 1, population: 40 },
  aiGoverned: { weight: 40, repos: 1, population: 8 },
  revert: { weight: 40, repos: 1, population: 40 },
  aiTrailer: { weight: 40, repos: 1, population: 20 },
  aiPreReviewed: { weight: 40, repos: 1, population: 20 },
});

const signals = (perRepo: PrRepoRow[], over: Partial<OrgPrSignals> = {}): OrgPrSignals => ({
  repos: perRepo.length,
  totalPrs: 40,
  avgMergeRate: 90,
  avgReviewedRate: 95,
  avgSmallPrRate: 60,
  avgAiInvolvedRate: 20,
  avgAiGovernedRate: 90,
  avgRevertRate: 1,
  avgAiTrailerRate: 10,
  avgAiPreReviewedRate: 5,
  typicalHoursToMerge: 4,
  typicalHoursToFirstReview: 2,
  tools: [],
  perRepo,
  rateBasis: basis(),
  ...over,
});

const gov = () => ({ perRepo: [] }) as unknown as OrgGovernance;

describe("derivePriorities: the review-integrity question", () => {
  it("case 5: 95% coverage with repo B at 9 of 10 instant approvals asks exactly one question", () => {
    const out = derivePriorities(signals([repo("B", { count: 9, population: 10 })]), gov());
    expect(out).toEqual([
      {
        severity: "improve",
        title: "Ask what approval means in 1 repo",
        evidence: "B: 9 of 10 approvals landed within 5 minutes of opening",
        href: "#review-integrity",
        action: "See approvals",
      },
    ]);
  });

  it("case 5: with B at 4 of 4 (under the floor) there is no item and the all-clear stands", () => {
    expect(derivePriorities(signals([repo("B", { count: 4, population: 4 })]), gov())).toEqual([]);
  });

  it("names two repos and counts the rest when several qualify", () => {
    const out = derivePriorities(
      signals([
        repo("B", { count: 9, population: 10 }),
        repo("C", { count: 6, population: 8 }),
        repo("D", { count: 5, population: 5 }),
      ]),
      gov(),
    );
    expect(out[0]!.title).toBe("Ask what approval means in 3 repos");
    expect(out[0]!.evidence).toBe(
      "D: 5 of 5 and B: 9 of 10 approvals landed within 5 minutes of opening, plus 1 more repo",
    );
  });

  it("guard: a fleet with no integrity data derives exactly what it did before", () => {
    const noBook = [repo("B", null, { integrity: { selfApproved: null, fastApproval: null } })];
    expect(derivePriorities(signals(noBook), gov())).toEqual([]);
    const { integrity: _drop, ...bare } = repo("B", null);
    void _drop;
    const low = derivePriorities(signals([bare as PrRepoRow], { avgReviewedRate: 60 }), gov());
    expect(low.map((p) => p.title)).toEqual(["Lift human review coverage"]);
  });

  it("guard: the question never names a person, only the repository", () => {
    const out = derivePriorities(signals([repo("B", { count: 9, population: 10 })]), gov());
    expect(out[0]!.evidence).not.toMatch(/reviewer|@/);
  });
});
