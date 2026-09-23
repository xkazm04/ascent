// @vitest-environment jsdom
//
// The rendered half of the review-integrity read: DeliveryPrSection shows, under the PR band, the
// fleet's self-approved and under-5-minute approval shares with their pooled basis, keeps the
// RATE_BASIS caveats one click away, and says "not measured" (never 0%) when no scan carried them.
// The claim is always about a repository's approvals: no login and no reviewer name is rendered.

import { describe, expect, it } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { DeliveryPrSection } from "./DeliveryPrSection";
import { ReviewIntegrityStrip } from "./ReviewIntegrityStrip";
import { reviewIntegrityModel } from "./reviewIntegrityModel";
import type { OrgPrSignals, PrRepoRow } from "@/lib/db";
import type { FleetRateId } from "@/lib/db/org-signals";

type Counts = { count: number; population: number } | null;

const row = (name: string, reviewedRate: number, selfApproved: Counts, fastApproval: Counts): PrRepoRow => ({
  fullName: `acme/${name}`,
  name,
  analyzed: 40,
  mergeRate: 90,
  reviewedRate,
  smallPrRate: 60,
  aiInvolvedRate: 20,
  aiGovernedRate: 90,
  medianHoursToMerge: 4,
  revertRate: 1,
  medianHoursToFirstReview: 2,
  aiTrailerRate: 10,
  aiPreReviewedRate: 5,
  population: { revert: 40, reviewed: 30, aiGoverned: 8, merge: 38, smallPr: 40, aiInvolved: 40, aiTrailer: 20, aiPreReviewed: 20 },
  integrity: { selfApproved, fastApproval },
});

const rowA = () => row("alpha", 85, { count: 2, population: 20 }, { count: 3, population: 15 });
const rowB = () => row("bravo", 95, { count: 0, population: 10 }, { count: 9, population: 10 });

const basis = (): Record<FleetRateId, { weight: number; repos: number; population: number | null }> => ({
  merge: { weight: 80, repos: 2, population: 76 },
  reviewed: { weight: 80, repos: 2, population: 60 },
  smallPr: { weight: 80, repos: 2, population: 80 },
  aiInvolved: { weight: 80, repos: 2, population: 80 },
  aiGoverned: { weight: 80, repos: 2, population: 16 },
  revert: { weight: 80, repos: 2, population: 80 },
  aiTrailer: { weight: 80, repos: 2, population: 40 },
  aiPreReviewed: { weight: 80, repos: 2, population: 40 },
});

const signals = (perRepo: PrRepoRow[]): OrgPrSignals => ({
  repos: perRepo.length,
  totalPrs: 80,
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
  perRepo,
  rateBasis: basis(),
});

const strip = (container: HTMLElement) => container.querySelector<HTMLElement>("#review-integrity")!;

describe("DeliveryPrSection: review integrity under the band", () => {
  it("case 6: shows the pooled self-approved 7% and approved-within-5-minutes 48% with their basis", () => {
    const { container } = render(<DeliveryPrSection pr={signals([rowA(), rowB()])} />);
    const s = strip(container);
    expect(s).toBeTruthy();
    const text = s.textContent ?? "";
    // The optional "i" is the caveat chip's glyph, rendered between the label and the value.
    expect(text).toMatch(/self-approved\s*i?\s*7%/i);
    expect(text).toMatch(/approved within 5 minutes\s*i?\s*48%/i);
    expect(text).toMatch(/2 of 30 human-authored merged PRs/);
    expect(text).toMatch(/12 of 25 approved PRs/);
    // The question list links to the per-repo rows.
    const ask = within(s).getByRole("link", { name: /bravo: 9 of 10 approvals/ });
    expect(ask.getAttribute("href")).toBe("#per-repo");
  });

  it("case 6: the caveats are on demand, and nothing rendered names a person or carries an em dash", () => {
    const { container } = render(<DeliveryPrSection pr={signals([rowA(), rowB()])} />);
    const s = strip(container);
    expect(s.textContent).not.toMatch(/rubber stamp/);
    for (const chip of within(s).getAllByRole("button", { name: /^Why:/ })) fireEvent.click(chip);
    const text = s.textContent ?? "";
    expect(text).toMatch(/not proof of a rubber stamp/);
    expect(text).toMatch(/single-maintainer repository/);
    expect(text).not.toContain(String.fromCharCode(0x2014)); // no em dash
    expect(text).not.toMatch(/@|reviewer [A-Z]/);
  });

  it("case 3: a fleet whose scans predate the counts renders a void, never a 0%", () => {
    const pre = [rowA(), rowB()].map((r) => ({ ...r, integrity: { selfApproved: null, fastApproval: null } }));
    const { container } = render(<ReviewIntegrityStrip model={reviewIntegrityModel(pre)} />);
    expect(container.textContent).toMatch(/not measured in these scans/);
    expect(container.textContent).not.toMatch(/0%/);
  });

  it("guard: the Review coverage cell and the coverage strip ordering are identical without the counts", () => {
    const withCounts = render(<DeliveryPrSection pr={signals([rowA(), rowB()])} />);
    const coverageCell = (c: HTMLElement) =>
      [...c.querySelectorAll("div")].find((d) => d.firstElementChild?.textContent === "Review coverage")?.textContent;
    const stripLabel = (c: HTMLElement) => c.querySelector('#per-repo [role="img"]')?.getAttribute("aria-label");
    const a = { cell: coverageCell(withCounts.container), strip: stripLabel(withCounts.container) };
    withCounts.unmount();
    const bare = [rowA(), rowB()].map(({ integrity: _drop, ...r }) => (void _drop, r as PrRepoRow));
    const without = render(<DeliveryPrSection pr={signals(bare)} />);
    expect(a.cell).toMatch(/90%/);
    expect({ cell: coverageCell(without.container), strip: stripLabel(without.container) }).toEqual(a);
  });
});
