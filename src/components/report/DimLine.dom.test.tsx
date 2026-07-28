// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DimLine, type ScanMeta } from "./DimLine";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const meta = (engines: (string | undefined)[]): ScanMeta[] =>
  engines.map((engine, i) => ({ at: `2026-07-0${i + 1}T09:00:00.000Z`, engine: engine ?? "claude-cli" }));

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
    expect(screen.getByText(/30 of 100 on .*\(demo scan — deterministic rubric, no model\)/i)).toBeInTheDocument();
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
