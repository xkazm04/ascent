// @vitest-environment jsdom
//
// The revert-rate "elevated" signal must not be carried by color ALONE (WCAG 1.4.1). Above the 10%
// threshold the metric shows an explicit "▲ elevated" text marker in the warn token — a colorblind or
// low-contrast reader gets the cue without perceiving the tint. Below the threshold there is no marker.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrSignalsPanel } from "./PrSignalsPanel";
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
});
