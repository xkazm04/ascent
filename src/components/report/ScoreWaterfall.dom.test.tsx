// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DimensionId, DimensionResult, ScanReport } from "@/lib/types";
import { ScoreWaterfall } from "./ScoreWaterfall";

// usePrefersReducedMotion reads window.matchMedia, which jsdom does not implement. Answer "reduce":
// the mount-grow transition then snaps straight to its final width, so the asserted inline widths are
// the real ones instead of the pre-rAF "0%" entrance frame.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

const IDS: DimensionId[] = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"];

function dim(id: DimensionId, score: number, weight: number): DimensionResult {
  return { id, name: `${id} name`, score, weight, signalScore: score, llmScore: score, summary: "", evidence: [], strengths: [], gaps: [] };
}

/** ScoreWaterfall reads only `dimensions` + `overallScore` (via `contributions`). */
function report(scores: number[]): ScanReport {
  const dimensions = scores.map((s, i) => dim(IDS[i]!, s, 1));
  const overallScore = Math.round(scores.reduce((a, s) => a + s, 0) / scores.length);
  return { dimensions, overallScore } as unknown as ScanReport;
}

/** The rendered track segments, in order, with their inline widths. */
function segments(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-segment]"));
}
function headroom(container: HTMLElement) {
  return container.querySelector<HTMLElement>("[data-headroom]")!;
}

// G5-13. Every non-zero contribution used to claim a fixed 0.375rem minimum on a flex track. With 9
// dimensions those floors could sum past the container, so flex distorted the proportions AND the
// trailing `flex-1` headroom tail collapsed to zero — on exactly the low-scoring repos where "how far
// from 100 am I" is the story the chart exists to tell.

describe("ScoreWaterfall track — the headroom indicator survives 9 tiny contributions", () => {
  it("keeps the headroom element present and floored when nine micro contributions are drawn", () => {
    // Nine dimensions at 5/100 → 5 points total drawn, 95 points of headroom. This is the shape that
    // used to erase the tail.
    const { container } = render(<ScoreWaterfall report={report(Array(9).fill(5))} />);
    const tail = headroom(container);
    expect(tail).toBeInTheDocument();
    expect(tail.style.minWidth).toBe("0.125rem");
    expect(tail.getAttribute("title")).toBe("95 pts of headroom to 100");
  });

  it("no segment carries a pixel minWidth any more — width is the contribution, full stop", () => {
    const { container } = render(<ScoreWaterfall report={report([90, 80, 70, 60, 50, 40, 30, 20, 10])} />);
    for (const s of segments(container)) expect(s.style.minWidth).toBe("");
  });

  it("summed segment widths never exceed the 100% track", () => {
    const { container } = render(<ScoreWaterfall report={report(Array(9).fill(100))} />);
    const total = segments(container).reduce((a, s) => a + parseFloat(s.style.width), 0);
    expect(total).toBeLessThanOrEqual(100.0001);
    // A perfect 100 leaves genuinely no headroom — and the floor correctly does NOT invent any.
    expect(headroom(container).style.minWidth).toBe("0px");
  });
});

describe("ScoreWaterfall track — micro contributions aggregate rather than being floored or hidden", () => {
  it("rolls the sub-threshold dimensions into one labeled grey sliver", () => {
    // One dominant dimension plus eight at 5/100 (0.56 pts each, all under the 1.5pt threshold).
    const { container } = render(<ScoreWaterfall report={report([95, 5, 5, 5, 5, 5, 5, 5, 5])} />);
    const keys = segments(container).map((s) => s.dataset.segment);
    expect(keys).toEqual(["D1", "__aggregate__"]);
    const sliver = segments(container)[1]!;
    expect(sliver.style.backgroundColor).toBe("rgb(71, 85, 105)"); // neutral — it carries no single score
    expect(sliver.getAttribute("title")).toContain("8 dimensions under 1.5 pts each");
  });

  it("names the sliver in a visible note so the grey block is never unexplained", () => {
    render(<ScoreWaterfall report={report([95, 5, 5, 5, 5, 5, 5, 5, 5])} />);
    expect(screen.getByText(/grey sliver aggregates 8 dimensions/i)).toBeInTheDocument();
  });

  it("shows no aggregate note when every contribution is drawable on its own", () => {
    const { container } = render(<ScoreWaterfall report={report([90, 80, 70, 60, 50, 40, 30, 20, 10])} />);
    expect(segments(container).map((s) => s.dataset.segment)).toEqual(IDS);
    expect(screen.queryByText(/grey sliver aggregates/i)).not.toBeInTheDocument();
  });
});

describe("ScoreWaterfall track — degenerate score sets", () => {
  it("an ALL-ZERO report draws no segments at all and hands the whole track to headroom", () => {
    // A zero contributes zero width. The old floor gave every one of the nine a visible 6px block —
    // a bar that looked like progress on a repo that had none.
    const { container } = render(<ScoreWaterfall report={report(Array(9).fill(0))} />);
    expect(segments(container)).toHaveLength(0);
    expect(headroom(container).getAttribute("title")).toBe("100 pts of headroom to 100");
    // Every dimension is still itemized below the track — nothing is hidden, only un-drawn.
    expect(screen.getAllByText("+0")).toHaveLength(9);
  });

  it("a single-dimension report renders one segment and the rest as headroom", () => {
    const { container } = render(<ScoreWaterfall report={report([40])} />);
    expect(segments(container)).toHaveLength(1);
    expect(headroom(container).getAttribute("title")).toBe("60 pts of headroom to 100");
  });

  it("an empty dimension set renders an all-headroom track without throwing", () => {
    const { container } = render(<ScoreWaterfall report={{ dimensions: [], overallScore: 0 } as unknown as ScanReport} />);
    expect(segments(container)).toHaveLength(0);
    expect(headroom(container).getAttribute("title")).toBe("100 pts of headroom to 100");
  });
});
