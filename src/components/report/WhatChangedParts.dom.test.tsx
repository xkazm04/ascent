// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DimensionDiff } from "@/lib/report/compare";
import { DimensionDiffCard } from "./WhatChangedParts";

// G5-14. `DiffBar` correctly refuses to invent a delta when only one side of the comparison scored a
// dimension (a rubric/model change added or dropped it) — but it then drew a plain score-coloured bar,
// visually identical to a dimension that held steady. A real structural change in WHAT was measured
// read as "nothing happened".

function diff(over: Partial<DimensionDiff>): DimensionDiff {
  return {
    id: "D2",
    name: "Testing",
    before: null,
    after: null,
    delta: null,
    signalDelta: null,
    closedGaps: [],
    openedGaps: [],
    appearedSignals: [],
    disappearedSignals: [],
    attribution: null,
    ...over,
  };
}

const bar = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-uncomparable]");

describe("DiffBar — a one-sided dimension is flagged as structural, not drawn as a flat score", () => {
  it("labels a dimension the new scan added and says there is no baseline", () => {
    render(<DimensionDiffCard d={diff({ before: null, after: 64 })} />);
    expect(screen.getByText(/new in this scan — no baseline to compare/i)).toBeInTheDocument();
    expect(screen.queryByText(/no longer scored/i)).not.toBeInTheDocument();
  });

  it("labels a dimension the new scan dropped and says there is nothing to compare", () => {
    render(<DimensionDiffCard d={diff({ before: 64, after: null })} />);
    expect(screen.getByText(/no longer scored — nothing to compare/i)).toBeInTheDocument();
    expect(screen.queryByText(/new in this scan/i)).not.toBeInTheDocument();
  });

  it("handles the both-null case without claiming either direction", () => {
    const { container } = render(<DimensionDiffCard d={diff({ before: null, after: null })} />);
    expect(screen.getByText(/not scored in either scan/i)).toBeInTheDocument();
    // Nothing was measured, so nothing is drawn — not a zero-width bar pretending to be a score.
    expect(bar(container)).toBeNull();
  });

  it("hatches the one-sided fill in neutral so it cannot be mistaken for a plotted score", () => {
    const { container } = render(<DimensionDiffCard d={diff({ before: null, after: 64 })} />);
    const fill = bar(container)!;
    expect(fill.style.width).toBe("64%");
    expect(fill.style.backgroundColor).toBe("rgb(71, 85, 105)"); // neutral, not the score's hue
    expect(fill.style.backgroundImage).toContain("repeating-linear-gradient");
  });

  it("does NOT borrow the gain/loss hues — an added dimension is not an improvement", () => {
    // Emerald/red are reserved for real movement. Colouring a structural change with them would
    // assert a direction the data does not have.
    const { container } = render(<DimensionDiffCard d={diff({ before: null, after: 64 })} />);
    const fill = bar(container)!;
    expect(fill.style.backgroundColor).not.toBe("rgb(34, 197, 94)");
    expect(fill.style.backgroundColor).not.toBe("rgb(239, 68, 68)");
  });
});

describe("DiffBar — a two-sided comparison is untouched", () => {
  it("draws the gain segment green with no structural badge", () => {
    const { container } = render(<DimensionDiffCard d={diff({ before: 40, after: 64, delta: 24 })} />);
    expect(screen.queryByText(/new in this scan|no longer scored|not scored in either/i)).not.toBeInTheDocument();
    expect(bar(container)).toBeNull();
    const segs = Array.from(container.querySelectorAll<HTMLElement>("div.absolute"));
    expect(segs.map((s) => s.style.backgroundColor)).toContain("rgb(34, 197, 94)");
  });

  it("a HELD-STEADY dimension is now visually distinct from a one-sided one (the reported confusion)", () => {
    const { container } = render(<DimensionDiffCard d={diff({ before: 64, after: 64, delta: 0 })} />);
    expect(bar(container)).toBeNull(); // no hatch
    expect(screen.queryByText(/new in this scan|no longer scored/i)).not.toBeInTheDocument();
    // The neutral base runs to the (unchanged) level and the delta segment has zero width.
    const segs = Array.from(container.querySelectorAll<HTMLElement>("div.absolute"));
    expect(segs.map((s) => s.style.width)).toEqual(["64%", "0%"]);
  });

  it("draws a loss segment red", () => {
    const { container } = render(<DimensionDiffCard d={diff({ before: 64, after: 40, delta: -24 })} />);
    const segs = Array.from(container.querySelectorAll<HTMLElement>("div.absolute"));
    expect(segs.map((s) => s.style.backgroundColor)).toContain("rgb(239, 68, 68)");
  });
});
