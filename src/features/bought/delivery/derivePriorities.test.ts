// The "Fix first" punch list's first test — the export comment has promised one since the list was
// written ("Exported for the page to test emptiness"), and none existed. The branches that matter are
// the ones that NAME something: a repo called out as the fleet's weakest reverter is the loudest
// sentence on the tab, and it used to be derivable from a 2-PR repo (see REVERT_MIN_SAMPLE).

import { describe, expect, it } from "vitest";
import { derivePriorities } from "./derivePriorities";
import type { OrgGovernance, OrgPrSignals, PrRepoRow } from "@/lib/db";
import type { FleetRateId } from "@/lib/db/org-signals";

const repo = (over: Partial<PrRepoRow> = {}): PrRepoRow => ({
  fullName: "acme/web",
  name: "web",
  analyzed: 40,
  mergeRate: 90,
  reviewedRate: 90,
  smallPrRate: 60,
  aiInvolvedRate: 20,
  aiGovernedRate: 90,
  medianHoursToMerge: 4,
  revertRate: 1,
  medianHoursToFirstReview: 2,
  aiTrailerRate: 10,
  aiPreReviewedRate: 5,
  population: { revert: 40, reviewed: 30, aiGoverned: 8, merge: 38, smallPr: 40, aiInvolved: 40 },
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

const signals = (over: Partial<OrgPrSignals> = {}): OrgPrSignals => ({
  repos: 1,
  totalPrs: 40,
  avgMergeRate: 90,
  avgReviewedRate: 90,
  avgSmallPrRate: 60,
  avgAiInvolvedRate: 20,
  avgAiGovernedRate: 90,
  avgRevertRate: 1,
  avgAiTrailerRate: 10,
  avgAiPreReviewedRate: 5,
  typicalHoursToMerge: 4,
  typicalHoursToFirstReview: 2,
  tools: [],
  perRepo: [repo()],
  rateBasis: basis(),
  ...over,
});

const gov = (over: Partial<OrgGovernance> = {}): OrgGovernance =>
  ({ perRepo: [], ...over }) as unknown as OrgGovernance;

const titles = (p: ReturnType<typeof derivePriorities>) => p.map((x) => x.title);

describe("derivePriorities — the healthy fleet", () => {
  it("returns nothing when every signal clears its bar (the page renders the all-clear)", () => {
    expect(derivePriorities(signals(), gov())).toEqual([]);
  });

  it("returns nothing when both inputs are null (a tab with no data claims no problems)", () => {
    expect(derivePriorities(null, null)).toEqual([]);
  });
});

describe("derivePriorities — review + merge signals", () => {
  it("calls out review coverage below the target and names the weakest repo", () => {
    const out = derivePriorities(
      signals({ avgReviewedRate: 40, perRepo: [repo({ name: "slow", reviewedRate: 20 })] }),
      gov(),
    );
    expect(titles(out)).toContain("Lift human review coverage");
    expect(out.find((p) => p.title === "Lift human review coverage")!.evidence).toMatch(/slow at 20%/);
  });

  it("relies on the producer's riskiest-first sort: the FIRST measured row is the one named", () => {
    const out = derivePriorities(
      signals({
        avgReviewedRate: 40,
        perRepo: [repo({ name: "first", reviewedRate: 30 }), repo({ name: "second", reviewedRate: 10 })],
      }),
      gov(),
    );
    expect(out.find((p) => p.title === "Lift human review coverage")!.evidence).toMatch(/first at 30%/);
  });

  it("flags a slow first review and a slow merge separately", () => {
    const out = derivePriorities(signals({ typicalHoursToFirstReview: 40, typicalHoursToMerge: 100 }), gov());
    expect(titles(out)).toEqual(expect.arrayContaining(["Unblock the review queue", "Shorten time-to-merge"]));
  });
});

describe("derivePriorities — the revert priority's sample floor", () => {
  it("skips the revert priority entirely when the fleet rate is null (never measured)", () => {
    expect(titles(derivePriorities(signals({ avgRevertRate: null }), gov()))).not.toContain("Stabilize what ships");
  });

  it("raises it above the alert rate and names a repo that HAS a sample", () => {
    const out = derivePriorities(
      signals({
        avgRevertRate: 12,
        perRepo: [repo({ name: "big", revertRate: 15, population: { revert: 40 } })],
      }),
      gov(),
    );
    const p = out.find((x) => x.title === "Stabilize what ships")!;
    expect(p.evidence).toMatch(/worst: big at 15%/);
  });

  it("refuses to name a 2-PR repo as the worst reverter — the sentence survives without it", () => {
    const out = derivePriorities(
      signals({
        avgRevertRate: 12,
        perRepo: [repo({ name: "toy", revertRate: 50, population: { revert: 2 } })],
      }),
      gov(),
    );
    const p = out.find((x) => x.title === "Stabilize what ships")!;
    expect(p.evidence).toMatch(/12% of PRs are reverts/);
    expect(p.evidence).not.toMatch(/toy/);
  });

  it("prefers the worst repo ABOVE the floor over a louder one below it", () => {
    const out = derivePriorities(
      signals({
        avgRevertRate: 12,
        perRepo: [
          repo({ name: "toy", revertRate: 50, population: { revert: 3 } }),
          repo({ name: "real", revertRate: 14, population: { revert: 120 } }),
        ],
      }),
      gov(),
    );
    expect(out.find((x) => x.title === "Stabilize what ships")!.evidence).toMatch(/worst: real at 14%/);
  });

  it("excludes a repo whose revert denominator the scan never persisted (unknown is not a passed floor)", () => {
    const out = derivePriorities(
      signals({ avgRevertRate: 12, perRepo: [repo({ name: "legacy", revertRate: 40, population: {} })] }),
      gov(),
    );
    expect(out.find((x) => x.title === "Stabilize what ships")!.evidence).not.toMatch(/legacy/);
  });
});

describe("derivePriorities — ordering and cap", () => {
  it("puts every fix before every improve and caps the list at four", () => {
    const out = derivePriorities(
      signals({ avgReviewedRate: 10, avgRevertRate: 20, typicalHoursToMerge: 100, typicalHoursToFirstReview: 40 }),
      gov({
        perRepo: [
          { name: "a", protected: false, requiredApprovals: 0 },
          { name: "b", protected: true, requiredApprovals: 0 },
        ],
      } as unknown as Partial<OrgGovernance>),
    );
    expect(out).toHaveLength(4);
    expect(out.slice(0, 2).every((p) => p.severity === "fix")).toBe(true);
  });
});
