// @vitest-environment jsdom
//
// G6-05: `Meter` was a plain styled <div> with no ARIA progressbar semantics (screen readers got zero
// signal of goal/initiative progress) and no finiteness guard on `value` (a done/total ratio with
// total === 0 propagated NaN straight into `style.width`, silently rendering as an empty bar). This pins
// the ARIA values a screen reader would actually read, and that a non-finite value renders as an inert
// 0%-wide bar instead of `width: NaN%`.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Meter, MeterRow } from "./uiMeters";

describe("Meter", () => {
  it("exposes progressbar semantics with the current value a screen reader would read", () => {
    render(<Meter value={42} ariaLabel="AI adoption" />);
    const bar = screen.getByRole("progressbar", { name: "AI adoption" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("clamps aria-valuenow and the rendered width to [0, 100]", () => {
    const { container, rerender } = render(<Meter value={150} ariaLabel="over" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(container.querySelector(".animate-meter")).toHaveStyle({ width: "100%" });

    rerender(<Meter value={-10} ariaLabel="under" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("guards a non-finite value instead of rendering width: NaN%", () => {
    const { container } = render(<Meter value={NaN} ariaLabel="broken ratio" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    const fill = container.querySelector(".animate-meter") as HTMLElement;
    expect(fill.style.width).toBe("0%");
    expect(fill.style.width).not.toContain("NaN");
  });

  it("guards Infinity the same way (falls back to 0, not a clamped-but-confident 100%)", () => {
    const { container } = render(<Meter value={Infinity} ariaLabel="infinite" />);
    const fill = container.querySelector(".animate-meter") as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });
});

describe("MeterRow", () => {
  it("derives the Meter's accessible name from a string label", () => {
    render(<MeterRow layout="labelled" value={60} label="AI share" />);
    expect(screen.getByRole("progressbar", { name: "AI share" })).toBeInTheDocument();
  });

  it("lets an explicit ariaLabel override the label text", () => {
    render(<MeterRow layout="inline" value={30} ariaLabel="Explicit name" />);
    expect(screen.getByRole("progressbar", { name: "Explicit name" })).toBeInTheDocument();
  });
});
