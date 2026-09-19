// @vitest-environment jsdom
//
// The three marks the Briefing tab uses to replace a header sentence, pinned at the render layer.
//
//  - PeriodDumbbell replaced "This period's end state against the equal-length window before it."
//    The sentence is now the mark's generated <title>, and the origin is HOLLOW so the past does not
//    carry the same weight as the present.
//  - ProgramBaseline replaced "Its baseline is frozen the moment it starts, so every later number is
//    measured against a fixed origin." The origin is drawn in the kit's `decided` encoding — an
//    accent ring, because a person froze it and everything around it is a derived measurement.
//  - ImpactMovement puts gains and regressions on ONE symmetric axis, so a -6 and a +6 are the same
//    length in opposite directions.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PeriodDumbbell } from "./PeriodDumbbell";
import { ProgramBaseline } from "./ProgramBaseline";
import { ImpactMovement } from "./ImpactMovement";
import type { MovementRow } from "./impactView";

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

describe("ProgramBaseline", () => {
  it("draws the frozen origin in the kit's decided encoding — a ring, not a dot", () => {
    const { container } = render(
      <ProgramBaseline baseline={54} baselineAt="2026-06-01T00:00:00Z" now={62} targetLevel="L4" />,
    );
    const origin = container.querySelector('[data-origin="baseline"]')!;
    expect(origin.getAttribute("fill")).toBe("none");
    expect(origin.getAttribute("stroke")).toBe("var(--color-accent)");
    expect(origin.querySelector("title")?.textContent).toMatch(/Decided by a human/i);
  });

  it("states, in the accessible name, that the origin is never recomputed", () => {
    render(<ProgramBaseline baseline={54} baselineAt="2026-06-01T00:00:00Z" now={62} targetLevel="L4" />);
    const svg = screen.getByRole("img", { name: /origin is never recomputed/i });
    expect(svg.getAttribute("aria-label")).toContain("origin frozen at 54");
    expect(svg.getAttribute("aria-label")).toContain("target rung L4 at 65");
  });

  it("draws no present-day mark and says so when there is no current standing", () => {
    render(<ProgramBaseline baseline={54} baselineAt="2026-06-01T00:00:00Z" now={null} targetLevel="L4" />);
    expect(screen.getByRole("img", { name: /no current standing measured/i })).toBeTruthy();
  });
});

describe("ImpactMovement", () => {
  const row = (dimId: string, points: number): MovementRow => ({ dimId, points, prs: 1, state: "measured" });

  it("gives a gain and a regression of equal size equal length, in opposite directions", () => {
    const { container } = render(<ImpactMovement rows={[row("D1", 6), row("D3", -6)]} />);
    const [up, down] = Array.from(container.querySelectorAll("rect"));
    expect(Number(up!.getAttribute("width"))).toBeCloseTo(Number(down!.getAttribute("width")), 3);
    expect(Number(down!.getAttribute("x"))).toBeLessThan(Number(up!.getAttribute("x")));
  });

  it("draws a void — no bars at all — when nothing has been re-scanned", () => {
    const { container } = render(<ImpactMovement rows={[]} />);
    expect(container.querySelectorAll("rect").length).toBe(0);
    expect(screen.getByRole("img", { name: /nothing re-scanned yet/i })).toBeTruthy();
  });

  it("refuses to plot bars when every verified merge measured zero — that is its own void", () => {
    const { container } = render(<ImpactMovement rows={[row("D1", 0)]} />);
    expect(container.querySelectorAll("rect").length).toBe(0);
    expect(screen.getByRole("img", { name: /measured zero movement/i })).toBeTruthy();
  });
});
