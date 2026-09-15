// @vitest-environment jsdom
//
// The strip is the first sight of the dimension section, replacing the sentence that counted the
// fleet's dimension debt ("N of 9 ... below 65") without ever locating it. What is worth pinning is
// the pair of promises the sentence could not keep: an unjudged phase draws a lane and prints no
// number, and the green floor is on the picture rather than in the words.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PhaseStandingStrip } from "@/features/standing/overview/PhaseStandingStrip";
import { GREEN_FLOOR, type PhaseStanding } from "@/features/standing/overview/phaseStanding";

const phase = (over: Partial<PhaseStanding> = {}): PhaseStanding => ({
  id: "author",
  label: "Author with AI",
  question: "How much of the work is AI doing?",
  avg: 72,
  state: "measured",
  owed: { n: 0, of: 3 },
  ...over,
});

describe("PhaseStandingStrip", () => {
  it("degrades to a labelled placeholder rather than an empty svg", () => {
    render(<PhaseStandingStrip phases={[]} />);
    expect(screen.getByRole("img", { name: /no dimensions scored/i })).toBeInTheDocument();
  });

  it("draws one bar per measured phase and prints its average", () => {
    const { container } = render(<PhaseStandingStrip phases={[phase(), phase({ id: "verify", label: "Verify", avg: 41, owed: { n: 2, of: 3 } })]} />);
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(2);
    expect([...container.querySelectorAll("[data-value]")].map((t) => t.textContent)).toEqual(["72", "41"]);
  });

  it("hatches an unjudged phase and prints NO number for it", () => {
    const { container } = render(<PhaseStandingStrip phases={[phase({ state: "not-judged", avg: null })]} />);
    expect(container.querySelector("[data-phase='author']")?.getAttribute("data-state")).toBe("not-judged");
    expect(container.querySelectorAll("[data-value]")).toHaveLength(0);
    // The hatch is the kit's, resolved through the shared <defs>, not a second 45° pattern.
    expect(container.querySelector("[data-bar]")?.getAttribute("fill")).toContain("ascent-viz-hatch");
  });

  it("draws no bar at all for a phase with no measurement", () => {
    const { container } = render(<PhaseStandingStrip phases={[phase({ state: "missing", avg: null })]} />);
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(0);
    // The empty lane track is still there, so the absence is locatable rather than a hole.
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(0);
  });

  it("puts the green floor on the picture, and the whole reading in the accessible name", () => {
    render(<PhaseStandingStrip phases={[phase({ avg: 41, owed: { n: 2, of: 3 } })]} />);
    const svg = screen.getByRole("img", { name: /green floor/i });
    expect(svg.getAttribute("aria-label")).toContain(String(GREEN_FLOOR));
    expect(svg.getAttribute("aria-label")).toContain("2 of 3 dimensions below green");
    expect(svg.getAttribute("aria-label")).toContain("is not a zero");
  });

  it("carries an sr-only table built from the same numbers the geometry is", () => {
    render(<PhaseStandingStrip phases={[phase({ avg: 41, owed: { n: 2, of: 3 } })]} />);
    expect(screen.getByRole("rowheader", { name: "Author with AI" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "41" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2 of 3" })).toBeInTheDocument();
  });
});
