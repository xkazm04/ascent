// @vitest-environment jsdom
//
// UAT `SAM-L1-06` (recurrence 2): "Flagged for review" named the dimension and the model's claim and
// never said what the disagreement DID — while the header integrity chip, three inches above, said the
// dimension had been widened. A reader who trusts the chip and then reads the row sees the product
// disagree with itself. One outcome word per row closes it, derived from the same record the chip reads.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Discrepancy, ScoreIntegrity } from "@/lib/types";
import { ReportDiscrepancies } from "./ReportNotices";
import { discrepancyOutcome } from "./discrepancyOutcome";

const d = (dimension: Discrepancy["dimension"], claim = "the detector missed the CI gate"): Discrepancy => ({
  dimension,
  claim,
});
const integrity = (over: Partial<ScoreIntegrity> = {}): ScoreIntegrity => ({
  d9Unmeasurable: false,
  widenedDims: [],
  effectiveBlend: 0.6,
  ...over,
});

describe("discrepancyOutcome", () => {
  it("says WIDENED for a dimension the engine actually widened", () => {
    expect(discrepancyOutcome(d("D3"), integrity({ widenedDims: ["D3"] })).label).toBe("widened");
    expect(discrepancyOutcome(d("D3"), integrity({ widenedDims: ["D3"] })).acted).toBe(true);
  });

  it("says the claim was LOST TO THE BUDGET when the audit blew the per-scan cap", () => {
    // widenCapped outranks everything: when the budget blows, NOTHING was widened and the D9 hatch is
    // suppressed too — so no row on the panel may claim it moved the score.
    const capped = integrity({ widenCapped: true, d9Unmeasurable: false });
    expect(discrepancyOutcome(d("D3"), capped).label).toBe("lost to the budget");
    expect(discrepancyOutcome(d("D9"), capped).label).toBe("lost to the budget");
    expect(discrepancyOutcome(d("D9"), capped).acted).toBe(false);
  });

  it("says STRUCTURALLY INELIGIBLE for a flagged dimension that never reached the blend", () => {
    // D9 is deterministic and is excluded from the widening loop by construction; a D3 flag that the
    // budget dropped from `widenedDims` is the same shape.
    expect(discrepancyOutcome(d("D9"), integrity({ widenedDims: ["D3"] })).label).toBe("structurally ineligible");
    expect(discrepancyOutcome(d("D5"), integrity({ widenedDims: ["D3"] })).label).toBe("structurally ineligible");
  });

  it("names D9's own escape hatch rather than calling it ineligible", () => {
    expect(discrepancyOutcome(d("D9"), integrity({ d9Unmeasurable: true })).label).toBe("D9 dropped as unmeasurable");
  });

  it("refuses to guess on a snapshot written before the record existed", () => {
    expect(discrepancyOutcome(d("D3"), undefined).label).toBe("outcome not recorded");
    expect(discrepancyOutcome(d("D3"), undefined).acted).toBe(false);
  });
});

describe("ReportDiscrepancies", () => {
  it("states the outcome on every row, and agrees with the integrity record", () => {
    render(
      <ReportDiscrepancies
        discrepancies={[d("D3"), d("D9", "CodeQL runs via default setup")]}
        integrity={integrity({ widenedDims: ["D3"], d9Unmeasurable: true })}
      />,
    );
    expect(screen.getByText("widened")).toBeInTheDocument();
    expect(screen.getByText("D9 dropped as unmeasurable")).toBeInTheDocument();
  });

  it("carries each outcome's reason as BOTH a tooltip and sr-only text, never hover-only", () => {
    render(<ReportDiscrepancies discrepancies={[d("D3")]} integrity={integrity({ widenedDims: ["D3"] })} />);
    const badge = screen.getByText("widened").closest("span")!;
    const hint = badge.getAttribute("title")!;
    expect(hint).toMatch(/guardband was doubled/);
    expect(badge).toHaveTextContent(hint);
  });

  it("renders nothing at all when the auditor flagged nothing", () => {
    const { container } = render(<ReportDiscrepancies discrepancies={[]} integrity={integrity()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
