// @vitest-environment jsdom
//
// The mark the Briefing tab uses to replace a header sentence, pinned at the render layer.
//
//  - PeriodDumbbell replaced "This period's end state against the equal-length window before it."
//    The sentence is now the mark's generated <title>, and the origin is HOLLOW so the past does not
//    carry the same weight as the present.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PeriodDumbbell } from "./PeriodDumbbell";

describe("PeriodDumbbell", () => {
  it("carries the window framing as its title instead of as a header line", () => {
    render(<PeriodDumbbell label="Overall" prior={71} now={76} delta={5} />);
    const mark = screen.getByRole("img", { name: /equal-length window before this one/i });
    expect(mark.querySelector("title")?.textContent).toContain("71 at the end of the equal-length window");
  });

  it("draws the origin hollow and the present filled, so the two ends are not read as equals", () => {
    const { container } = render(<PeriodDumbbell label="Overall" prior={71} now={76} delta={5} />);
    const [origin, present] = Array.from(container.querySelectorAll("circle"));
    expect(origin!.getAttribute("fill")).toBe("none");
    expect(present!.getAttribute("fill")).not.toBe("none");
  });

  it("degrades to an em dash rather than plotting a non-finite end", () => {
    render(<PeriodDumbbell label="Overall" prior={Number.NaN} now={76} delta={0} />);
    expect(screen.getByRole("img", { name: /no comparable prior window/i })).toBeTruthy();
  });
});
