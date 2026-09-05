// @vitest-environment jsdom
//
// The revert-rate "elevated" signal must not be carried by color ALONE (WCAG 1.4.1). Above the 10%
// threshold the metric shows an explicit "▲ elevated" text marker in the warn token — a colorblind or
// low-contrast reader gets the cue without perceiving the tint. Below the threshold there is no marker.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrSignalsPanel } from "./PrSignalsPanel";
import { qualifiedRate, RATE_BASIS, REVERT_RATE_ELEVATED, SMALL_PR_MAX_LINES } from "@/lib/analyze/pr-thresholds";
import type { PrStats } from "@/lib/types";

const base: PrStats = {
  analyzed: 40,
  totalCount: 120,
  open: 3,
  merged: 30,
  closedUnmerged: 7,
  mergeRate: 81,
  reviewedRate: 72,
  avgReviews: 1.2,
  avgComments: 3.4,
  medianHoursToMerge: 12,
  medianHoursToFirstReview: 4,
  avgLineChanges: 180,
  avgChangedFiles: 6,
  smallPrRate: 62,
  botAuthoredRate: 0,
  aiInvolvedRate: 0,
  aiGovernedRate: null,
  revertRate: 3,
  draftRate: 0,
  tools: [],
};

describe("PrSignalsPanel revert-rate signal (not color-alone)", () => {
  it("adds a non-color 'elevated' text cue when the revert rate exceeds the threshold", () => {
    render(<PrSignalsPanel stats={{ ...base, revertRate: 18 }} />);
    expect(screen.getByText("18%")).toBeInTheDocument();
    expect(screen.getByText(/elevated/i)).toBeInTheDocument();
  });

  it("shows no 'elevated' cue when the revert rate is within range", () => {
    render(<PrSignalsPanel stats={{ ...base, revertRate: 3 }} />);
    expect(screen.getByText("3%")).toBeInTheDocument();
    expect(screen.queryByText(/elevated/i)).toBeNull();
  });

  // The threshold is the shared named constant (pr-thresholds.ts), strictly greater-than: exactly
  // AT the threshold is unflagged, one point above flags. Pins the panel to the constant so a
  // retune there moves the UI with it (score-charts-visuals #4).
  it("is unflagged exactly at REVERT_RATE_ELEVATED and flagged one point above", () => {
    const { unmount } = render(<PrSignalsPanel stats={{ ...base, revertRate: REVERT_RATE_ELEVATED }} />);
    expect(screen.queryByText(/elevated/i)).toBeNull();
    unmount();
    render(<PrSignalsPanel stats={{ ...base, revertRate: REVERT_RATE_ELEVATED + 1 }} />);
    expect(screen.getByText(/elevated/i)).toBeInTheDocument();
  });

  it("quotes the analyzer's small-PR line ceiling in the hint (single source of truth)", () => {
    render(<PrSignalsPanel stats={base} />);
    expect(screen.getByText(`≤${SMALL_PR_MAX_LINES} lines`)).toBeInTheDocument();
  });
});

// ── The qualified-rate contract on the render side ────────────────────────────
//
// A percentage on this panel must arrive with what it is a percentage OF. `stats.rates` (the
// qualified book, pr-thresholds.ts) is the only place that basis exists, so these pin that the panel
// reads THROUGH `rateReading` — the number, its counts, its exclusions and its sample floor together
// — rather than off the bare scalar beside it, and that the two review-integrity signals ship with
// their caveats visible rather than as verdicts.

/** A scan whose blob carries the rate book, i.e. one written after the contract. */
function withRates(over: Partial<NonNullable<PrStats["rates"]>> = {}): PrStats {
  return {
    ...base,
    rates: {
      smallPr: qualifiedRate("smallPr", 25, 40),
      revert: qualifiedRate("revert", 2, 40),
      aiInvolved: qualifiedRate("aiInvolved", 12, 40),
      reviewed: qualifiedRate("reviewed", 18, 22),
      selfApproved: qualifiedRate("selfApproved", 3, 22),
      fastApproval: qualifiedRate("fastApproval", 4, 16),
      ...over,
    },
  };
}

describe("PrSignalsPanel qualified rates", () => {
  it("renders the review-coverage figure from the rate book WITH its counts and basis", () => {
    render(<PrSignalsPanel stats={withRates()} />);
    // 18/22 = 82%, NOT the bare `reviewedRate: 72` scalar the same blob still carries.
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getAllByText(/18 of 22/).length).toBeGreaterThan(0); // tile hint + the sr-only qualifier
    // The qualifier itself is in the DOM (sr-only + title), not merely on hover.
    expect(screen.getAllByText(/human-authored merged pull requests/).length).toBeGreaterThan(0);
  });

  it("shows 'n/a' — never a fabricated 0 — for a rate under its own sample floor", () => {
    render(<PrSignalsPanel stats={withRates({ reviewed: qualifiedRate("reviewed", 0, 3) })} />);
    expect(screen.getAllByText("n/a").length).toBeGreaterThan(0);
    expect(screen.getByText(/below the 5-sample floor/)).toBeInTheDocument();
  });

  it("surfaces self-approval as a COUNT and fast approval as a share, each with its caveat visible", () => {
    render(<PrSignalsPanel stats={withRates()} />);
    expect(screen.getByText("3")).toBeInTheDocument(); // self-approved count, not a percentage
    expect(screen.getByText(/^of 22 human-merged PRs$/)).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument(); // fast approvals 4/16
    expect(screen.getByText(/^4 of 16 approved PRs$/)).toBeInTheDocument();
    // A signal is not a verdict: both caveats render as text, not tooltips.
    expect(screen.getByText(RATE_BASIS.selfApproved.caveat!)).toBeInTheDocument();
    expect(screen.getByText(RATE_BASIS.fastApproval.caveat!)).toBeInTheDocument();
  });

  it("omits the review-integrity block entirely for a scan written before the contract", () => {
    render(<PrSignalsPanel stats={base} />); // no `rates`
    expect(screen.queryByText(/Review integrity/i)).toBeNull();
    expect(screen.getByText("72%")).toBeInTheDocument(); // falls back to the historical scalar
  });
});
