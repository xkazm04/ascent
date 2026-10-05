// @vitest-environment jsdom
//
// What the population strip must RENDER, as distinct from what the model computes
// (segmentViz.distribution.test.ts): one mark per repo, a mean mark that is visibly a different kind of
// mark, the n printed for both sides, and — the load-bearing one — an unmeasured side drawn as a gap
// with NO mark at 0 and NO number, with the absence available to a screen reader in words.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SegmentDistribution, SegmentDistributionRow } from "./SegmentDistribution";
import { distributionRows } from "./segmentViz";
import type { SegmentComparison, SegmentSummary } from "@/lib/db";

const pt = (fullName: string, overall: number, dims: Record<string, number> = {}) => ({
  fullName,
  overall,
  dims: Object.entries(dims).map(([dimId, score]) => ({ dimId, score })),
});

const side = (name: string, points: ReturnType<typeof pt>[], mean: number | null): SegmentSummary =>
  ({
    id: name,
    name,
    repoCount: points.length,
    scannedCount: points.length,
    avgOverall: mean,
    avgAdoption: 55,
    avgRigor: 65,
    posture: mean === null ? null : "balanced",
    dimAverages: [],
    points,
  }) as SegmentSummary;

const rowsOf = (a: SegmentSummary, b: SegmentSummary) =>
  distributionRows(
    {
      a,
      b,
      deltas: { overall: a.avgOverall == null || b.avgOverall == null ? null : a.avgOverall - b.avgOverall, adoption: null, rigor: null },
      dimDeltas: [],
    } as SegmentComparison,
    (d) => d,
  );

const A = side("Platform", [pt("acme/a-one", 40), pt("acme/a-two", 60), pt("acme/a-three", 80)], 60);
const B = side("Legacy", [pt("acme/b-one", 70), pt("acme/b-two", 90)], 80);

describe("SegmentDistribution — the population, the mean, and the n", () => {
  it("draws one item mark per repo PLUS a separate mean mark, never the same mark twice", () => {
    const { container } = render(<SegmentDistributionRow row={rowsOf(A, B)[0]!} />);
    // 3 + 2 item ticks, each addressable by the repo it is.
    expect(container.querySelectorAll("[data-item]")).toHaveLength(5);
    expect(container.querySelector('[data-item="acme/a-one"]')).toBeTruthy();
    // One mean per side, and it is a circle while the items are lines: different kind, different mark.
    const means = container.querySelectorAll("[data-mean]");
    expect(means).toHaveLength(2);
    expect(means[0]!.tagName.toLowerCase()).toBe("circle");
    expect(container.querySelector("[data-item]")!.tagName.toLowerCase()).toBe("line");
  });

  it("prints the n each side drew on, beside its mark and in the accessible name", () => {
    render(<SegmentDistributionRow row={rowsOf(A, B)[0]!} />);
    expect(screen.getByText("mean of 3 scanned repos · mean of 2 scanned repos")).toBeTruthy();
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toContain("Platform: mean of 3 scanned repos, 60");
    expect(img.getAttribute("aria-label")).toContain("Legacy: mean of 2 scanned repos, 80");
  });

  it("a side with nothing scanned is a GAP: no mark, no number, and the absence said in words", () => {
    const empty = side("New", [], null);
    const { container } = render(<SegmentDistributionRow row={rowsOf(empty, B)[0]!} />);
    const gap = container.querySelector('[data-side="a"]')!;
    expect(gap.querySelectorAll("[data-item]")).toHaveLength(0);
    expect(gap.querySelector("[data-mean]")).toBeNull(); // no mark at 0
    expect(gap.textContent).not.toMatch(/\d/); // and no number printed for that side
    expect(gap.textContent).toContain("—");
    // The accessible text names the absence rather than leaving the side silent.
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("New: no scanned repository");
    expect(screen.getAllByText(/no scanned repository/).length).toBeGreaterThan(0);
  });

  it("a one-repo side draws its single item mark and refuses to call itself a segment mean", () => {
    const solo = side("Solo", [pt("acme/only", 60)], 60);
    const { container } = render(<SegmentDistributionRow row={rowsOf(solo, B)[0]!} />);
    const s = container.querySelector('[data-side="a"]')!;
    expect(s.querySelectorAll("[data-item]")).toHaveLength(1);
    expect(s.querySelector("[data-mean]")).toBeTruthy(); // the mean IS drawn, but labelled honestly
    expect(screen.getAllByText(/one scanned repo, not a segment mean/).length).toBeGreaterThan(0);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Solo: one scanned repo, not a segment mean");
  });

  it("the sr-only table states every side's mean AND its basis, so the marks are not the only reading", () => {
    render(<SegmentDistribution rows={rowsOf(A, B)} title="Overall, per repo" />);
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toContain("mean of 3 scanned repos");
    expect(cells).toContain("mean of 2 scanned repos");
    expect(cells).toContain("60");
    expect(cells).toContain("80");
  });

  it("an empty row set says so instead of rendering an empty chart frame", () => {
    render(<SegmentDistribution rows={[]} title="Overall, per repo" />);
    expect(screen.getByRole("img", { name: /no comparable metric/ })).toBeTruthy();
  });
});
