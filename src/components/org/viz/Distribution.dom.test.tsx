// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Distribution } from "./Distribution";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

const FIVE = { min: 0, q1: 12, median: 31, q3: 58, max: 96 };

describe("Distribution accessibility", () => {
  it("names the chart from the SAME numbers the geometry uses", () => {
    render(<Distribution {...FIVE} you={44} n={41} label="AI-authored share" unit="%" />);
    const img = screen.getByRole("img", { name: /AI-authored share/i });
    const name = img.getAttribute("aria-label")!;
    for (const v of ["0%", "12%", "31%", "58%", "96%", "44%"]) expect(name).toContain(v);
    expect(name).toContain("across 41");
  });

  it("exposes an sr-only table equivalent — one row per statistic", () => {
    render(<Distribution {...FIVE} you={44} n={41} label="AI-authored share" unit="%" />);
    const table = screen.getByRole("table", { name: /AI-authored share/i });
    expect(table).toBeInTheDocument();
    for (const r of ["Minimum", "First quartile", "Median", "Third quartile", "Maximum", "You", "Population"]) {
      expect(screen.getByRole("rowheader", { name: r })).toBeInTheDocument();
    }
  });
});

describe("Distribution geometry guards", () => {
  it("plots no 'you' marker when the viewer's value is absent — never a dot at zero", () => {
    const { container } = render(<Distribution {...FIVE} />);
    expect(container.querySelector("[data-you]")).toBeNull();
    expect(screen.queryByRole("rowheader", { name: "You" })).not.toBeInTheDocument();
  });

  it("drops a NaN 'you' rather than plotting it", () => {
    const { container } = render(<Distribution {...FIVE} you={Number.NaN} />);
    expect(container.querySelector("[data-you]")).toBeNull();
  });

  it("degrades to a labelled placeholder when a quartile is missing, instead of a NaN box", () => {
    const { container } = render(<Distribution {...FIVE} median={Number.NaN} label="Share" />);
    expect(screen.getByRole("img", { name: /Share: no distribution data/i })).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("survives a degenerate domain (every quartile identical) with finite geometry", () => {
    const { container } = render(<Distribution min={5} q1={5} median={5} q3={5} max={5} you={5} />);
    const box = container.querySelector("[data-box]")!;
    expect(Number(box.getAttribute("x"))).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(Number(box.getAttribute("width")))).toBe(true);
    expect(container.querySelector("[data-median]")!.getAttribute("x1")).not.toContain("NaN");
  });

  it("clamps an out-of-range 'you' to the edge and says so", () => {
    render(<Distribution {...FIVE} you={140} label="Share" unit="%" />);
    expect(screen.getByRole("img", { name: /outside the plotted range/i })).toBeInTheDocument();
  });
});
