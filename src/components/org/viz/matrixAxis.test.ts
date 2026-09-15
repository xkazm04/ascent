import { describe, expect, it } from "vitest";
import { AXIS_MAX_CHARS, AXIS_MAX_LINES, axisHeaderHeight, wrapAxisLabel } from "./matrixAxis";

describe("wrapAxisLabel", () => {
  it("leaves a label that already fits on one line, unchanged", () => {
    expect(wrapAxisLabel("Declared")).toEqual(["Declared"]);
    expect(wrapAxisLabel("Sent")).toEqual(["Sent"]);
  });

  it("wraps the real labels that were overlapping their neighbour before this fix", () => {
    // Wave 1's contributors privacy matrix shipped these two in a 46-unit column, where ~8
    // characters fit. Both ran into the next column.
    expect(wrapAxisLabel("Counted here")).toEqual(["Counted", "here"]);
    // Breaks after the hyphen rather than mid-morpheme, then runs out of lines: "row" is dropped to
    // an ellipsis and the full label stays in the header's <title>. A label this long is really a
    // caller problem — the guarantee here is only that it cannot overlap its neighbour.
    expect(wrapAxisLabel("Per-person row")).toEqual(["Per-", "person…"]);
  });

  it("never returns a line wider than the column", () => {
    const labels = ["Declared", "Observed", "Enforced", "Counted here", "Per-person row", "In-boundary", "Billed to", "Not judged"];
    for (const l of labels) {
      for (const line of wrapAxisLabel(l)) expect(line.length).toBeLessThanOrEqual(AXIS_MAX_CHARS);
    }
  });

  it("never returns more than the line ceiling", () => {
    const long = "Enforced across every repository in the fleet";
    expect(wrapAxisLabel(long).length).toBeLessThanOrEqual(AXIS_MAX_LINES);
  });

  it("ellipsizes rather than silently truncating when the label cannot fit", () => {
    const lines = wrapAxisLabel("Enforced across every repository");
    expect(lines).toHaveLength(AXIS_MAX_LINES);
    expect(lines[AXIS_MAX_LINES - 1]).toMatch(/…$/);
  });

  it("hard-splits a single word too wide to pack, rather than letting it overhang", () => {
    // The failure this guards is visual and silent: SVG <text> does not clip, so one long word
    // would simply be drawn across the neighbouring column.
    for (const line of wrapAxisLabel("Uninterruptible")) expect(line.length).toBeLessThanOrEqual(AXIS_MAX_CHARS);
  });

  it("survives an empty or whitespace label without producing a NaN-height header", () => {
    expect(wrapAxisLabel("")).toEqual([""]);
    expect(wrapAxisLabel("   ")).toEqual([""]);
    expect(Number.isFinite(axisHeaderHeight([wrapAxisLabel("")]))).toBe(true);
  });
});

describe("axisHeaderHeight", () => {
  it("grows with the tallest label, so a two-line header cannot overlap the first row", () => {
    const one = axisHeaderHeight([["Declared"]]);
    const two = axisHeaderHeight([["Declared"], ["Counted", "here"]]);
    expect(two).toBeGreaterThan(one);
  });

  it("keeps the single-line height at the value the grid shipped with", () => {
    // 18 was the old HEADER_H constant; a one-line matrix must not shift.
    expect(axisHeaderHeight([["Declared"], ["Observed"]])).toBe(18);
  });
});
