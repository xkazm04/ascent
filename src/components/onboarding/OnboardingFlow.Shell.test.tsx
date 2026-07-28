// @vitest-environment jsdom
//
// G6-11 (second half): "Step N of 3" previously existed ONLY in the sr-only live region — announced
// once on a step change and then gone, with no persistent visible stepper for a sighted mouse user and
// no ongoing programmatic marker either. `Shell` now also renders a small always-present stepper with
// `aria-current="step"` on the active segment, so step position is answerable at any time.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Shell } from "./OnboardingFlow.Shell";

describe("OnboardingFlow.Shell — visible stepper with aria-current (G6-11)", () => {
  it("marks exactly the active step aria-current='step'", () => {
    render(
      <Shell step={2} stepAnnounce="Step 2 of 3: Choose repositories">
        <div>content</div>
      </Shell>,
    );
    const current = screen.getByText("Choose repositories").closest("li");
    expect(current).toHaveAttribute("aria-current", "step");
    const others = screen.getAllByRole("listitem").filter((li) => li !== current);
    others.forEach((li) => expect(li).not.toHaveAttribute("aria-current"));
  });

  it("still renders the sr-only live-region announcement alongside the stepper", () => {
    render(
      <Shell step={1} stepAnnounce="Step 1 of 3: Choose a source">
        <div>content</div>
      </Shell>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Step 1 of 3: Choose a source");
  });

  it("renders no stepper at all when `step` is omitted", () => {
    render(<Shell stepAnnounce="">child</Shell>);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("renders the child content regardless of step", () => {
    render(
      <Shell step={3} stepAnnounce="">
        <div>the step content</div>
      </Shell>,
    );
    expect(screen.getByText("the step content")).toBeInTheDocument();
  });
});
