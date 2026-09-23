// The review-integrity read: the fleet's self-approved and under-5-minute approval shares, POOLED
// from the analyzer's rate book (sum of counts over sum of populations), never a mean of per-repo
// percentages. A repo whose scan predates the book is named as such and kept out of the pool; a
// repo under the sample floor keeps its counts in the pool but publishes no percentage of its own.

import { describe, expect, it } from "vitest";
import type { PrRepoRow } from "@/lib/db";
import { integrityQuestions, reviewIntegrityModel } from "./reviewIntegrityModel";

type Counts = { count: number; population: number } | null;

const row = (name: string, selfApproved: Counts, fastApproval: Counts, over: Partial<PrRepoRow> = {}): PrRepoRow => ({
  fullName: `acme/${name}`,
  name,
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
  population: { reviewed: 30 },
  integrity: { selfApproved, fastApproval },
  ...over,
});

const A = () => row("A", { count: 2, population: 20 }, { count: 3, population: 15 });
const B = () => row("B", { count: 0, population: 10 }, { count: 9, population: 10 });
/** A repo whose latest scan predates the rate book: no integrity counts at all. */
const legacy = (name = "L") => row(name, null, null);

describe("reviewIntegrityModel: pooled fleet shares", () => {
  it("case 1: pools counts across repos (7% and 48%), not the means 5% and 55%", () => {
    const m = reviewIntegrityModel([A(), B()]);
    expect(m.fleet).not.toBeNull();
    expect(m.fleet!.selfApproved).toMatchObject({ percent: 7, count: 2, population: 30, repos: 2 });
    expect(m.fleet!.selfApproved.basis).toBe("2 of 30 human-authored merged PRs");
    expect(m.fleet!.fastApproval).toMatchObject({ percent: 48, count: 12, population: 25, repos: 2 });
    expect(m.fleet!.fastApproval.basis).toBe("12 of 25 approved PRs");
    expect(m.fleet!.selfApproved.legacyNote).toBeNull();
  });

  it("case 2: a repo under the floor keeps its counts in the pool; a pre-book repo is named and excluded", () => {
    const small = row("S", { count: 1, population: 6 }, { count: 2, population: 3 });
    const m = reviewIntegrityModel([A(), small, legacy()]);
    const bySlug = new Map(m.repos.map((r) => [r.name, r]));
    expect(bySlug.get("S")!.fastApproval).toEqual({ state: "below-floor", percent: null, count: 2, population: 3 });
    expect(bySlug.get("S")!.selfApproved).toMatchObject({ state: "measured", percent: 17 });
    expect(bySlug.get("L")!.fastApproval).toEqual({ state: "not-persisted", percent: null, count: null, population: null });
    // S's 2 of 3 enters the pool: 3 + 2 of 15 + 3.
    expect(m.fleet!.fastApproval).toMatchObject({ count: 5, population: 18, repos: 2, legacyRepos: 1, percent: 28 });
    expect(m.fleet!.fastApproval.legacyNote).toBe("1 repo predates these counts");
    expect(reviewIntegrityModel([A(), legacy("L1"), legacy("L2")]).fleet!.selfApproved.legacyNote).toBe(
      "2 repos predate these counts",
    );
  });

  it("case 2 (floor): a pooled population under 5 publishes no fleet percentage", () => {
    const m = reviewIntegrityModel([row("T", { count: 1, population: 2 }, { count: 1, population: 2 })]);
    expect(m.fleet!.fastApproval.percent).toBeNull();
    expect(m.fleet!.fastApproval.basis).toMatch(/below the 5-PR floor/);
  });

  it("case 3: every row without the book leaves the fleet unmeasured (null), never 0", () => {
    const m = reviewIntegrityModel([legacy("L1"), legacy("L2")]);
    expect(m.fleet).toBeNull();
    expect(m.questions).toEqual([]);
    // A row object from before the field existed at all reads the same way.
    const { integrity: _drop, ...bare } = A();
    void _drop;
    expect(reviewIntegrityModel([bare as PrRepoRow]).fleet).toBeNull();
  });

  it("carries the RATE_BASIS caveats without an em dash", () => {
    const m = reviewIntegrityModel([A(), B()]);
    expect(m.fleet!.fastApproval.caveat).toMatch(/not proof of a rubber stamp/);
    expect(m.fleet!.selfApproved.caveat).toMatch(/single-maintainer repository/);
    expect(`${m.fleet!.fastApproval.caveat}${m.fleet!.selfApproved.caveat}`).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("integrityQuestions: repos where instant approval dominates", () => {
  it("case 4: lists repos with at least 5 approved PRs at a 50%+ fast share, highest share first", () => {
    const half = row("H", { count: 0, population: 8 }, { count: 3, population: 6 });
    const tiny = row("T", { count: 0, population: 4 }, { count: 4, population: 4 });
    const qs = integrityQuestions([A(), half, tiny, B()]);
    expect(qs.map((q) => q.name)).toEqual(["B", "H"]);
    expect(qs[0]).toMatchObject({ count: 9, population: 10, percent: 90 });
    expect(qs[0]!.sentence).toBe("B: 9 of 10 approvals landed within 5 minutes of opening");
    expect(reviewIntegrityModel([A(), half, tiny, B()]).questions.map((q) => q.name)).toEqual(["B", "H"]);
  });

  it("case 4: a repo at 4 of 4 is under the floor and is not asked about", () => {
    expect(integrityQuestions([row("T", null, { count: 4, population: 4 })])).toEqual([]);
  });

  it("case 4: a share just under half (49.5%) is not rounded up into the list", () => {
    expect(integrityQuestions([row("N", null, { count: 99, population: 200 })])).toEqual([]);
  });
});
