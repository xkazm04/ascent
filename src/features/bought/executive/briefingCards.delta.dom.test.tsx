// @vitest-environment jsdom
//
// The period delta's BASIS at the render layer (challenge card 2).
//
// The briefing's delta used to be mean(current fleet) − mean(baseline fleet), so onboarding a
// low-scoring repository mid-period printed a slip no repository experienced, with no denominator
// beside it. The figure is now `rollup.movement` (cohort-matched), and every surface that prints it
// prints the cohort it was measured over from ONE composer — so the denominator cannot be dropped on
// one of the four.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BriefingTiles } from "./briefingCards";
import { PriorPeriodGrid } from "./briefingShared";
import type { ExecBriefing } from "@/lib/org/briefing";

const MATURITY: ExecBriefing["maturity"] = { overall: 62, levelId: "L3", levelName: "Managed", adoption: 58, rigor: 66 };

const movement = (over: Partial<NonNullable<ExecBriefing["periodMovement"]>> = {}) => ({
  overall: 6,
  adoption: 4,
  rigor: 8,
  cohortSize: 8,
  onboarded: 0,
  departed: 0,
  ...over,
});

describe("BriefingTiles — the delta carries the cohort it was measured over", () => {
  it("states the matched denominator beside the delta badge", () => {
    const { container } = render(
      <BriefingTiles maturity={MATURITY} benchmark={null} realScoredCount={8} delta={6} deltaLabel="vs last 90 days" movement={movement()} />,
    );
    expect(container.textContent).toContain("over 8 repositories scanned on both sides of this period");
    // No composition change ⇒ no "0 onboarded" in a board-facing caption.
    expect(container.textContent).not.toContain("onboarded");
  });

  it("states a composition change as its own figure, never folded into the delta", () => {
    const { container } = render(
      <BriefingTiles
        maturity={MATURITY}
        benchmark={null}
        realScoredCount={11}
        delta={-2}
        deltaLabel="vs last 90 days"
        movement={movement({ overall: -2, cohortSize: 6, onboarded: 3, departed: 1 })}
      />,
    );
    expect(container.textContent).toContain("over 6 repositories scanned on both sides of this period");
    expect(container.textContent).toContain("3 repositories onboarded");
    expect(container.textContent).toContain("1 repository departed");
  });

  it("renders NO delta badge and NO caption when no repo was scanned on both sides", () => {
    const { container } = render(
      <BriefingTiles maturity={MATURITY} benchmark={null} realScoredCount={8} delta={null} deltaLabel="vs last 90 days" movement={null} />,
    );
    // A delta over an empty cohort is not a measurement: neither the badge nor a 0 appears.
    expect(container.textContent).not.toContain("vs last 90 days");
    expect(container.textContent).not.toContain("both sides of this period");
  });
});

describe("PriorPeriodGrid — two population means are a standing comparison, not movement", () => {
  const prior: Parameters<typeof PriorPeriodGrid>[0]["prior"] = {
    overall: 58,
    adoption: 54,
    rigor: 62,
    dOverall: 4,
    dAdoption: 4,
    dRigor: 4,
    dims: [],
  };
  const now = { overall: 62, adoption: 58, rigor: 66 };

  it("labels the difference with BOTH denominators when the measured population changed", () => {
    const { container } = render(<PriorPeriodGrid prior={prior} now={now} nowScoredCount={8} priorScoredCount={4} />);
    expect(container.textContent).toContain("Standing comparison, not movement");
    expect(container.textContent).toContain("8 repositories");
    expect(container.textContent).toContain("4 in the previous period");
  });

  it("keeps the present wording when both windows were measured over the same denominator", () => {
    const { container } = render(<PriorPeriodGrid prior={prior} now={now} nowScoredCount={8} priorScoredCount={8} />);
    expect(container.textContent).not.toContain("Standing comparison");
  });
});
