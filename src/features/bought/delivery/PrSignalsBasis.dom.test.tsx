// @vitest-environment jsdom
//
// The rendered half of the delivery-basis work: prBasis.test.ts pins the sentences, this pins that
// the band and the per-repo table actually SHOW them — and that a rate with no sample still renders
// an em dash rather than a basis line asserting precision about nothing.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrSignalsBand } from "./PrSignalsBand";
import { PrRepoTable } from "./PrRepoTable";
import type { OrgPrSignals, PrRepoRow } from "@/lib/db";
import type { FleetRateId } from "@/lib/db/org-signals";

const repo = (over: Partial<PrRepoRow> = {}): PrRepoRow => ({
  fullName: "acme/web",
  name: "web",
  analyzed: 40,
  mergeRate: 90,
  reviewedRate: 75,
  smallPrRate: 60,
  aiInvolvedRate: 20,
  aiGovernedRate: 80,
  medianHoursToMerge: 4,
  revertRate: 2,
  medianHoursToFirstReview: 2,
  aiTrailerRate: 10,
  aiPreReviewedRate: 5,
  population: { revert: 40, reviewed: 30, aiGoverned: 8, merge: 38, smallPr: 40, aiInvolved: 40, aiTrailer: 20, aiPreReviewed: 20 },
  ...over,
});

const fullBasis = (): Record<FleetRateId, { weight: number; repos: number; population: number | null }> => ({
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
  avgReviewedRate: 75,
  avgSmallPrRate: 60,
  avgAiInvolvedRate: 20,
  avgAiGovernedRate: 80,
  avgRevertRate: 2,
  avgAiTrailerRate: 10,
  avgAiPreReviewedRate: 5,
  typicalHoursToMerge: 4,
  typicalHoursToFirstReview: 2,
  tools: [],
  perRepo: [repo()],
  rateBasis: fullBasis(),
  ...over,
});

describe("PrSignalsBand basis", () => {
  it("gives every measured rate its own population and repo count", () => {
    const { container } = render(<PrSignalsBand pr={signals()} />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/basis: 30 · 1 repo/); // review coverage, over human-merged PRs — not 40
    expect(text).toMatch(/basis: 8 · 1 repo/); // AI reviewed, over AI-involved PRs
    // The full sentence rides a title AND an sr-only span, so hover and screen reader agree.
    expect(container.querySelector('[title*="human-authored merged PRs"]')).toBeTruthy();
  });

  it("states the hour readings as means of per-repo medians with their repo count", () => {
    const { container } = render(<PrSignalsBand pr={signals()} />);
    expect(container.querySelector('[title*="unweighted mean of the per-repo median hours to merge"]')).toBeTruthy();
  });

  it("renders an unmeasured rate as an em dash with NO basis attached", () => {
    const basis = fullBasis();
    basis.reviewed = { weight: 0, repos: 0, population: null };
    const { container } = render(<PrSignalsBand pr={signals({ avgReviewedRate: null, rateBasis: basis })} />);
    expect(container.textContent).toMatch(/—/);
    expect(container.textContent).not.toMatch(/basis: 0/);
  });

  it("says the sample size is unknown rather than borrowing the fleet total", () => {
    const basis = fullBasis();
    basis.aiGoverned = { weight: 40, repos: 1, population: null };
    const { container } = render(<PrSignalsBand pr={signals({ rateBasis: basis })} />);
    expect(container.textContent).toMatch(/sample size unknown/);
  });
});

describe("PrRepoTable denominators", () => {
  it("carries each rate's own denominator in the row, not just the analyzed count", () => {
    const { container } = render(<PrRepoTable rows={[repo()]} />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/75%\/30/); // reviewed, over human-merged PRs
    expect(text).toMatch(/80%\/8/); // AI reviewed, over AI-involved PRs
    expect(text).toMatch(/90%\/38/); // merge, over decided PRs
  });

  it("marks an unpersisted denominator as unknown instead of falling back to analyzed", () => {
    const { container } = render(<PrRepoTable rows={[repo({ population: {} })]} />);
    expect(container.textContent).toMatch(/90%\/\?/);
    expect(container.querySelector('[title*="not persisted by this scan"]')).toBeTruthy();
  });

  it("still renders a null rate as an em dash", () => {
    render(<PrRepoTable rows={[repo({ reviewedRate: null, revertRate: null })]} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
