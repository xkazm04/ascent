// @vitest-environment jsdom
//
// The two AI-delivery drawings that carry a refusal:
//
//   • the unit-economics ribbon, whose money stage must be a VOID that BREAKS the chain when no
//     connected provider reports cost — never an estimate and never a zero;
//   • the AI-vs-human failure split, whose buckets go void under the sample floor so one bad deploy
//     out of one can never be drawn as a 100% failure rate.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { UnitEconomicsFlow } from "./UnitEconomicsFlow";
import { FailureSplitMark } from "./FailureSplitMark";
import { DoraSmallMultiple } from "./DoraSmallMultiple";
import { doraPanels } from "./doraPanels";
import type { DeliveryOutcomes, OutcomeBucket } from "@/lib/db/delivery-outcomes";

const bucket = (over: Partial<OutcomeBucket> = {}): OutcomeBucket => ({ deployments: 20, failed: 2, failureRate: 10, ...over });

const outcomes = (over: Partial<DeliveryOutcomes> = {}): DeliveryOutcomes => ({
  total: 51,
  failed: 6,
  failureRate: 12,
  perWeek: 8,
  medianRestoreHours: 3,
  attributed: 40,
  unattributed: 11,
  coverage: 78,
  ai: bucket(),
  human: bucket({ failureRate: 6, failed: 1 }),
  failureRateGap: 4,
  environments: ["production"],
  from: null,
  to: null,
  ...over,
});

describe("UnitEconomicsFlow — the money stage", () => {
  it("breaks the ribbon when nothing reported cost", () => {
    const { container } = render(
      <UnitEconomicsFlow fleet={{ sessions: 40, producedCode: 28, costCents: 0, mergedAiChanges: 9 }} reposWithoutDenominator={0} />,
    );
    const spend = container.querySelector('[data-stage="spend"]');
    expect(spend?.getAttribute("data-state")).toBe("missing");
    // The connector out of a void stage is not drawn — the chain visibly does not join.
    expect(container.querySelector('[data-connector="spend"]')).toBeNull();
    // And the void prints an em dash where the figure would be, never a 0.
    expect(container.textContent).toMatch(/—/);
    expect(container.textContent).toMatch(/no cost source/);
  });

  it("draws the whole chain, connectors included, when spend is measured", () => {
    const { container } = render(
      <UnitEconomicsFlow fleet={{ sessions: 40, producedCode: 28, costCents: 12_300, mergedAiChanges: 9 }} reposWithoutDenominator={0} />,
    );
    expect(container.querySelector('[data-stage="spend"]')?.getAttribute("data-state")).toBe("measured");
    expect(container.querySelector('[data-connector="spend"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/no cost source/);
  });

  it("keeps the excluded-repo count as its own reading rather than a paragraph", () => {
    const { container } = render(
      <UnitEconomicsFlow fleet={{ sessions: 40, producedCode: 28, costCents: 12_300, mergedAiChanges: 9 }} reposWithoutDenominator={3} />,
    );
    expect(container.textContent).toMatch(/3 repos excluded/);
    expect(container.querySelector('button[aria-label="Why: excluded repositories"]')).toBeTruthy();
  });
});

describe("FailureSplitMark — the paired comparison", () => {
  it("brackets the gap between the two rates instead of stating it in a sentence", () => {
    const o = outcomes();
    const { container } = render(<FailureSplitMark ai={o.ai} human={o.human} gap={o.failureRateGap} periodTitle="Last 30 days" />);
    expect(container.querySelector("[data-gap]")?.getAttribute("data-gap")).toBe("4");
    expect(container.textContent).toMatch(/\+4 pts/);
    expect(container.textContent).toMatch(/fail 4 points more often/);
  });

  it("voids a bucket under the sample floor and draws no bar to misread", () => {
    const { container } = render(
      <FailureSplitMark ai={bucket({ deployments: 1, failed: 1, failureRate: null })} human={bucket()} gap={null} periodTitle="Last 30 days" />,
    );
    const ai = container.querySelector('[data-bucket="ai"]');
    expect(ai?.getAttribute("data-state")).toBe("missing");
    expect(container.querySelector("[data-gap]")).toBeNull();
    expect(container.textContent).toMatch(/Not comparable/);
  });

  it("keeps the residual-contamination caveat reachable from the comparison itself", () => {
    const o = outcomes();
    const { container } = render(<FailureSplitMark ai={o.ai} human={o.human} gap={o.failureRateGap} periodTitle="Last 30 days" />);
    expect(container.querySelector('button[aria-label="Why: what human-authored means here"]')).toBeTruthy();
  });
});

describe("DoraSmallMultiple — four readings, one instrument", () => {
  it("renders a withheld reading as a void track with an em dash and no numeral", () => {
    const { container } = render(<DoraSmallMultiple panels={doraPanels(outcomes({ failureRate: null, failed: 0 }))} />);
    const track = container.querySelector('[data-track="failure"]');
    expect(track?.getAttribute("data-state")).toBe("missing");
    expect(track?.getAttribute("fill")).toBe("none");
  });

  it("puts the two rate panels on the shared 0–100 axis and gives the others their own domain", () => {
    const panels = doraPanels(outcomes());
    expect(panels.find((p) => p.id === "failure")!.domainMax).toBe(100);
    expect(panels.find((p) => p.id === "coverage")!.domainMax).toBe(100);
    expect(panels.find((p) => p.id === "frequency")!.domainMax).toBe(10);
  });

  it("moves the attribution-coverage caveat into a disclosure rather than a footnote", () => {
    const { container } = render(<DoraSmallMultiple panels={doraPanels(outcomes())} />);
    expect(container.querySelector('button[aria-label="Why: Attribution coverage"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Merge trains/);
  });
});
