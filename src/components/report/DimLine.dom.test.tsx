// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TrendAnnotation } from "@/app/trends/annotations";
import { DimLine, type ScanMeta } from "./DimLine";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const at = (d: number) => `2026-07-0${d}T09:00:00.000Z`;

const meta = (engines: (string | undefined)[]): ScanMeta[] =>
  engines.map((engine, i) => ({ at: at(i + 1), engine: engine ?? "claude-cli" }));

function ann(day: number, label: string, extra: Partial<TrendAnnotation> = {}): TrendAnnotation {
  return {
    at: at(day),
    scanId: extra.scanId ?? `s${day}`,
    kind: extra.kind ?? "promotion",
    label,
    detail: extra.detail ?? `${label} detail`,
    delta: extra.delta ?? 8,
    sha: extra.sha ?? null,
    commitSha: extra.commitSha ?? null,
    ...extra,
    at: extra.at ?? at(day),
    label,
  };
}

// --- G5-15: no empty / all-null state ------------------------------------------------------
describe("DimLine empty state", () => {
  it("replaces the chart frame with a labeled 'No trend data' placeholder when every value is null", () => {
    // The line was already suppressed, but the level bands, gridlines and the "65" axis label still
    // drew — so a dimension with NO history looked like a real chart whose line was off-frame.
    render(<DimLine values={[null, null, null]} meta={meta([undefined, undefined, undefined])} name="Testing" />);
    expect(screen.getByRole("img", { name: /Testing: no trend data/i })).toBeInTheDocument();
    expect(screen.getByText("No trend data")).toBeInTheDocument();
    expect(screen.queryByText("65")).not.toBeInTheDocument(); // the band scaffolding is gone too
  });

  it("shows the placeholder for a completely empty series as well", () => {
    const { container } = render(<DimLine values={[]} meta={[]} />);
    expect(screen.getByRole("img", { name: /no trend data/i })).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("draws the real chart as soon as ONE value is present — the guard is exactly zero present points", () => {
    const { container } = render(<DimLine values={[null, 42, null]} meta={meta([undefined, undefined, undefined])} name="Testing" />);
    expect(screen.queryByText("No trend data")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });

  it("an all-ZERO series is a real chart, not an empty one — 0 is a measurement", () => {
    const { container } = render(<DimLine values={[0, 0, 0]} meta={meta([undefined, undefined, undefined])} name="Testing" />);
    expect(screen.queryByText("No trend data")).not.toBeInTheDocument();
    expect(container.querySelectorAll("circle")).toHaveLength(3);
  });
});

// --- G5-30: mock points on the small multiples ---------------------------------------------
describe("DimLine mock-vs-model point provenance", () => {
  it("draws the mock-scored point hollow and the model-scored ones solid", () => {
    const { container } = render(
      <DimLine values={[70, 30, 72]} meta={meta(["claude-cli", "mock", "claude-cli"])} name="Testing" />,
    );
    const hollow = container.querySelectorAll("circle[data-mock]");
    expect(hollow).toHaveLength(1);
    expect(hollow[0]!.getAttribute("fill")).toBe("var(--color-surface-strong)");
    expect(hollow[0]!.getAttribute("stroke")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(container.querySelectorAll("circle:not([data-mock])")).toHaveLength(2);
  });

  it("repeats the caveat in the screen-reader point list — the hollow mark is visual-only", () => {
    render(<DimLine values={[70, 30]} meta={meta(["claude-cli", "mock"])} name="Testing" />);
    expect(screen.getByText(/30 of 100 on .*\(demo scan: deterministic rubric, no model\)/i)).toBeInTheDocument();
    // The model-scored point carries no such qualifier.
    expect(screen.getByText(/^Testing 70 of 100 on [^(]*$/i)).toBeInTheDocument();
  });

  it("leaves a purely model-scored series entirely solid", () => {
    const { container } = render(
      <DimLine values={[70, 72]} meta={meta(["claude-cli", "bedrock"])} name="Testing" />,
    );
    expect(container.querySelectorAll("circle[data-mock]")).toHaveLength(0);
  });
});

// G5-18, small-multiples half: the same event markers the overall TrendChart draws, resolved by
// timestamp identity against this series' `meta.at` (never by array index — the range toggle slices
// the series while the annotation list is derived from the full history).
describe("DimLine timeline annotations", () => {
  it("draws the matching annotation's label and a vertical rule on that scan", () => {
    const { container } = render(
      <DimLine
        values={[60, 68, 70]}
        meta={meta([undefined, undefined, undefined])}
        name="Testing"
        annotations={[ann(2, "L3 → L4")]}
      />,
    );
    expect(screen.getByText("L3 → L4")).toBeInTheDocument();
    const mark = container.querySelector('g[data-annotation="s2"]');
    expect(mark).not.toBeNull();
    expect(mark!.querySelector("line")).not.toBeNull();
    expect(mark!.querySelector("title")?.textContent).toBe("L3 → L4 detail");
  });

  it("drops an annotation whose timestamp is not in this series — never clamps it to an edge", () => {
    const { container } = render(
      <DimLine
        values={[60, 68]}
        meta={meta([undefined, undefined])}
        name="Testing"
        annotations={[ann(9, "L3 → L4", { at: "2025-01-01T00:00:00.000Z", scanId: "s-out" })]}
      />,
    );
    expect(screen.queryByText("L3 → L4")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-annotation]")).toHaveLength(0);
  });

  it("still marks a scan where this dimension is absent — the event is overall, the x is the scan", () => {
    const { container } = render(
      <DimLine
        values={[null, 70]}
        meta={meta([undefined, undefined])}
        name="Testing"
        annotations={[ann(1, "-7", { kind: "regression", delta: -7 })]}
      />,
    );
    expect(screen.getByText("-7")).toBeInTheDocument();
    expect(container.querySelector('g[data-annotation="s1"]')).not.toBeNull();
  });

  it("does not draw annotations on the empty-state placeholder", () => {
    const { container } = render(
      <DimLine
        values={[null, null]}
        meta={meta([undefined, undefined])}
        name="Testing"
        annotations={[ann(1, "L3 → L4")]}
      />,
    );
    expect(screen.getByText("No trend data")).toBeInTheDocument();
    expect(screen.queryByText("L3 → L4")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-annotation]")).toHaveLength(0);
  });
});
