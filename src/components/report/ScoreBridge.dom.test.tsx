// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { DimensionId, ScanReport } from "@/lib/types";
import { MIXED_ENGINE_PAIR_NOTE } from "./chartEngine";
import type { ReportBaseline } from "./scoreBridgeModel";
import { ScoreWaterfall } from "./ScoreWaterfall";

// charts-1: the waterfall gains a "Since last scan" mode that explains the delta in points.

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

function report(engine = "claude"): ScanReport {
  const dims: { id: DimensionId; score: number; weight: number }[] = [
    { id: "D1", score: 60, weight: 0.71 },
    { id: "D2", score: 70, weight: 0.15 },
    { id: "D3", score: 40, weight: 0.14 },
  ];
  return {
    overallScore: 62,
    dimensions: dims.map((d) => ({ ...d, name: d.id, signalScore: d.score, llmScore: d.score, summary: "", evidence: [], strengths: [], gaps: [] })),
    engine: { provider: engine, model: "m", rubricVersion: "r24" },
  } as unknown as ScanReport;
}

const BASE: ReportBaseline = {
  id: "b",
  overallScore: 58,
  engineProvider: "claude",
  rubricVersion: "r24",
  dimensions: [{ dimId: "D1", score: 60 }, { dimId: "D2", score: 50 }, { dimId: "D3", score: 45 }],
};

const toggle = () => screen.queryByRole("button", { name: "Since last scan" });

describe("ScoreWaterfall - since-last-scan toggle", () => {
  it("no baseline -> no toggle (today's path)", () => {
    render(<ScoreWaterfall report={report()} />);
    expect(toggle()).toBeNull();
  });

  it("baseline null -> no toggle", () => {
    render(<ScoreWaterfall report={report()} baseline={null} />);
    expect(toggle()).toBeNull();
  });

  it("baseline without dimensions -> no toggle", () => {
    render(<ScoreWaterfall report={report()} baseline={{ ...BASE, dimensions: undefined }} />);
    expect(toggle()).toBeNull();
  });

  it("defaults to Now: the waterfall markup is the same as with no baseline", () => {
    const { container: a } = render(<ScoreWaterfall report={report()} />);
    const { container: b } = render(<ScoreWaterfall report={report()} baseline={BASE} />);
    expect(screen.getByRole("button", { name: "Now" }).getAttribute("aria-pressed")).toBe("true");
    expect(toggle()?.getAttribute("aria-pressed")).toBe("false");
    expect(b.querySelectorAll("[data-segment]").length).toBe(a.querySelectorAll("[data-segment]").length);
    expect(b.querySelector("ul")?.outerHTML).toBe(a.querySelector("ul")?.outerHTML);
    expect(b.querySelector("[data-bridge]")).toBeNull();
  });

  it("Since last scan renders one row per step with signed points and an sr-only sentence", () => {
    const { container } = render(<ScoreWaterfall report={report()} baseline={BASE} />);
    fireEvent.click(toggle()!);
    expect(toggle()?.getAttribute("aria-pressed")).toBe("true");
    const bridge = container.querySelector<HTMLElement>("[data-bridge]")!;
    expect(bridge).not.toBeNull();
    expect(bridge.textContent).toMatch(/58 → 62 \(\+4\)/);
    const rows = Array.from(bridge.querySelectorAll<HTMLElement>("[data-step]"));
    expect(rows.map((r) => r.getAttribute("data-step"))).toEqual(["D2", "D3", "residual"]);
    expect(within(rows[0]!).getByText("+3")).toBeTruthy();
    expect(within(rows[1]!).getByText("-0.7")).toBeTruthy();
    expect(rows[0]!.textContent).toContain("raised the overall by 3 points");
    expect(rows[1]!.textContent).toContain("lowered the overall by 0.7 points");
    expect(rows[2]!.textContent).toContain("rounding & reweighting");
    // The level view's segments are not drawn in this mode.
    expect(container.querySelector("[data-segment]")).toBeNull();
    expect(bridge.textContent).not.toContain(String.fromCharCode(0x2014));
  });

  it("mixed engines: the caveat sits ABOVE the steps and the steps still draw", () => {
    const { container } = render(<ScoreWaterfall report={report()} baseline={{ ...BASE, engineProvider: "mock" }} />);
    fireEvent.click(toggle()!);
    const bridge = container.querySelector<HTMLElement>("[data-bridge]")!;
    const caveat = bridge.querySelector<HTMLElement>("[data-caveat='mixed-engines']")!;
    expect(caveat.textContent).toContain(MIXED_ENGINE_PAIR_NOTE);
    const firstStep = bridge.querySelector<HTMLElement>("[data-step]")!;
    expect(firstStep).not.toBeNull();
    expect(caveat.compareDocumentPosition(firstStep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
