// @vitest-environment jsdom
//
// THE READOUT'S REFUSALS, pinned. Each test here is one way this surface could mislead the person who
// trusts it: a dropped void lane, a conditioned cost without its subset size, one reliability figure
// where two were computed, a threshold nobody can see, and an unmeasured constraint wearing the word
// "cleared".

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComparisonView } from "./ComparisonView";
import { armResult, comparisonReport, constraintVerdict, counted, reliability } from "./comparisonFixture";

const arm = (id: string) => screen.getByTestId("comparison").querySelector(`[data-arm="${id}"]`) as HTMLElement;

describe("ComparisonView", () => {
  it("says which way is good, without the reader having to know", () => {
    render(<ComparisonView report={comparisonReport()} />);
    expect(screen.getAllByText(/Claude tokens per verified point · lower is better/).length).toBe(2);
    expect(screen.getByTestId("comparison-verdict")).toHaveTextContent("advances");
  });

  it("has an empty state that does not pretend a run happened", () => {
    render(<ComparisonView report={null} />);
    expect(screen.getByTestId("comparison-empty")).toHaveTextContent("No comparison has run yet");
    expect(screen.queryByTestId("comparison-arm")).not.toBeInTheDocument();
  });

  it("withholds the headline while the arms are still running", () => {
    render(<ComparisonView report={comparisonReport()} running />);
    expect(screen.getByTestId("comparison-running")).toBeInTheDocument();
    expect(screen.getAllByTestId("comparison-metric-pending").length).toBe(2);
    expect(screen.queryByTestId("comparison-metric")).not.toBeInTheDocument();
    expect(screen.queryByTestId("comparison-verdict")).not.toBeInTheDocument();
  });

  it("shows a void, a parked and a timed-out lane as outcomes with their reasons", () => {
    render(<ComparisonView report={comparisonReport({ arms: [armResult("local", { voided: 2, parked: 1, timedOut: 3 })] })} />);
    const row = screen.getByTestId("comparison-outcome-voided");
    expect(row).toHaveTextContent("2");
    expect(row).toHaveTextContent(/edited the surface that scores it/);
    expect(screen.getByTestId("comparison-outcome-parked")).toHaveTextContent(/plan could not be parsed/);
    expect(screen.getByTestId("comparison-outcome-timedOut")).toHaveTextContent(/this arm's own ceiling/);
  });

  it("keeps the outcome rows at zero, so a void lane can never read as a missing row", () => {
    render(<ComparisonView report={comparisonReport({ arms: [armResult("claude")] })} />);
    expect(screen.getByTestId("comparison-outcome-voided")).toHaveTextContent("0");
  });

  it("prints the conditioned cost's subset size as part of the number", () => {
    render(<ComparisonView report={comparisonReport({ arms: [armResult("local")] })} />);
    expect(screen.getByTestId("comparison-cost-conditioned-subset")).toHaveTextContent("294 of 300 trials — every arm succeeded");
    expect(screen.getByTestId("comparison-cost-all-population")).toHaveTextContent("300 trials — completed trials");
  });

  it("renders BOTH reliability figures with their N, and marks a modelled one", () => {
    render(<ComparisonView report={comparisonReport({ arms: [armResult("local", { reliability: reliability({ modelled: true }) })] })} />);
    expect(screen.getByTestId("comparison-reliability-any")).toHaveTextContent("any of 3");
    expect(screen.getByTestId("comparison-reliability-any")).toHaveTextContent("96.3%");
    expect(screen.getByTestId("comparison-reliability-all")).toHaveTextContent("all of 3");
    expect(screen.getByTestId("comparison-reliability-all")).toHaveTextContent("29.7%");
    expect(screen.getByTestId("comparison-reliability-modelled")).toHaveTextContent("Modelled, not observed");
  });

  it("does not mark an observed reliability figure as modelled", () => {
    render(<ComparisonView report={comparisonReport({ arms: [armResult("local")] })} />);
    expect(screen.queryByTestId("comparison-reliability-modelled")).not.toBeInTheDocument();
  });

  it("shows a breached constraint as breached, with its declared threshold", () => {
    const breached = constraintVerdict("errors", {
      constraint: { id: "errors", label: "Regressions introduced", direction: "at-most", threshold: 2, kind: "quality" },
      observed: 5,
      cleared: false,
    });
    render(<ComparisonView report={comparisonReport({ constraints: [breached] })} />);
    const row = screen.getByTestId("comparison-constraint");
    expect(row).toHaveAttribute("data-state", "breached");
    expect(row).toHaveTextContent("BREACHED");
    expect(within(row).getByTestId("comparison-constraint-threshold")).toHaveTextContent("≤ 2");
    expect(row).toHaveTextContent("5");
  });

  it("reads a null observation as UNMEASURED, never as cleared", () => {
    const unmeasured = constraintVerdict("wall", { observed: null, cleared: null });
    render(<ComparisonView report={comparisonReport({ constraints: [unmeasured] })} />);
    const row = screen.getByTestId("comparison-constraint");
    expect(row).toHaveAttribute("data-state", "unmeasured");
    expect(row).toHaveTextContent("UNMEASURED");
    expect(row).not.toHaveTextContent("CLEARED");
    expect(row).toHaveTextContent("not measured");
  });

  it("labels a below-floor arm wherever it appears, and says why no arm advanced", () => {
    render(
      <ComparisonView
        report={comparisonReport({
          arms: [armResult("local", { belowFloor: true })],
          advance: null,
          note: "The local arm won the metric but breached the regression constraint.",
        })}
      />,
    );
    expect(within(arm("local")).getByTestId("comparison-below-floor")).toHaveTextContent("Below floor");
    expect(screen.getByTestId("comparison-no-advance")).toHaveTextContent("breached the regression constraint");
  });

  it("reports a null metric as a finding rather than a zero", () => {
    render(<ComparisonView report={comparisonReport({ arms: [armResult("local", { claudeTokensPerVerifiedPoint: null, verifiedPoints: 0 })] })} />);
    const metric = screen.getByTestId("comparison-metric");
    expect(metric).toHaveTextContent("—");
    expect(metric).toHaveTextContent("no verified points — not a zero");
  });

  it("prints an unmeasured cost as — rather than $0.00", () => {
    render(<ComparisonView report={comparisonReport({ arms: [armResult("local", { costConditioned: counted(null, 12, "every arm succeeded") })] })} />);
    expect(within(arm("local")).getByTestId("comparison-cost-conditioned-subset")).toHaveTextContent("12 of 300 trials");
    expect(within(arm("local")).getByText("—")).toBeInTheDocument();
  });
});
