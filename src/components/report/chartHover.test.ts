import { describe, it, expect } from "vitest";
import { nextHoverOnResize } from "@/components/report/chartHover";

// Pins the root-cause fix for the DimensionTrends white-screen (score-charts scan #1, High).
// `useChartHover` retains its hovered index across renders; the crash was that the index was only
// validated at set-time, so when a parent swapped the series for a SHORTER one (the range toggle
// dropping 40 points to 3 while a point was hovered) the retained index pointed past the new end and
// a downstream non-null assertion (`present[active]!.v`) threw mid-render. `nextHoverOnResize` is the
// pure reset rule the hook now applies DURING render; these lock its contract without a DOM renderer.
describe("nextHoverOnResize", () => {
  it("keeps the index when the series length is unchanged (normal hover, pointer just moved)", () => {
    expect(nextHoverOnResize(20, 40, 40)).toBe(20);
    expect(nextHoverOnResize(0, 3, 3)).toBe(0);
  });

  it("keeps a null index when the length is unchanged (nothing hovered)", () => {
    expect(nextHoverOnResize(null, 40, 40)).toBe(null);
  });

  it("RESETS to null when the series shrinks — the exact range-toggle crash path (40 → 3)", () => {
    // active=20 was valid over 40 points; after the toggle only 3 remain, so 20 is now out of bounds.
    expect(nextHoverOnResize(20, 40, 3)).toBe(null);
  });

  it("resets to null when the series grows too (a retained index may land on a different point)", () => {
    expect(nextHoverOnResize(1, 3, 40)).toBe(null);
  });

  it("resets even when the retained index is still numerically in range after the change", () => {
    // 1 < 3, so a bounds-only guard would have kept it — but the point at index 1 is a DIFFERENT scan
    // in the new series, so a length change always drops the hover rather than resurrect a stale one.
    expect(nextHoverOnResize(1, 5, 3)).toBe(null);
  });
});
