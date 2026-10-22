// @vitest-environment jsdom
//
// "An em dash is a missing measurement, not a zero" was the single most important caveat on the
// Delivery tab and the one prose could never enforce. This pins the drawing that now enforces it:
// the trend line BREAKS at an unmeasured day rather than bridging through zero.
//
// The assertion that matters in both is negative: no numeral, and no geometry, at zero.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DeliveryTrendPanel } from "./DeliveryTrendPanel";
import type { TrendPanelPoint } from "./deliveryTrendPanelMath";

const day = (date: string, value: number | null): TrendPanelPoint => ({ date, value, mock: false, scans: 2, repos: 3 });

describe("DeliveryTrendPanel — a day nobody measured", () => {
  it("breaks the line rather than bridging through zero", () => {
    const { container } = render(
      <DeliveryTrendPanel
        label="Review coverage"
        help="Share of merged human-authored PRs that carried an approving review."
        unit="%"
        points={[day("2026-09-01", 60), day("2026-09-02", null), day("2026-09-03", 80)]}
      />,
    );
    const d = container.querySelector("[data-line]")?.getAttribute("d") ?? "";
    // Two pen-downs and no line segment: the gap is the encoding.
    expect((d.match(/M/g) ?? []).length).toBe(2);
    expect(d).not.toMatch(/L/);
  });

  it("counts the absence as an absence instead of leaving it to be inferred", () => {
    const { container } = render(
      <DeliveryTrendPanel
        label="Review coverage"
        help="Share of merged human-authored PRs that carried an approving review."
        unit="%"
        points={[day("2026-09-01", 60), day("2026-09-02", null)]}
      />,
    );
    expect(container.textContent).toMatch(/1 no measurement/);
    expect(container.querySelector("svg[role=img]")?.getAttribute("aria-label")).toMatch(/gaps rather than zeroes/);
  });

  it("demotes the metric definition to a disclosure instead of printing it under the title", () => {
    const help = "Share of merged human-authored PRs that carried an approving review.";
    const { container } = render(
      <DeliveryTrendPanel label="Review coverage" help={help} unit="%" points={[day("2026-09-01", 60), day("2026-09-02", 70)]} />,
    );
    // Absent at first sight …
    expect(container.textContent).not.toContain(help);
    // … reachable on demand.
    const why = container.querySelector('button[aria-label="Why: Review coverage"]');
    expect(why).toBeTruthy();
  });

  it("renders the kit's missing state — not an empty chart — when nothing was measured at all", () => {
    const { container } = render(
      <DeliveryTrendPanel label="Merge rate" help="Of PRs that closed, the share that merged." unit="%" points={[day("2026-09-01", null)]} />,
    );
    const img = container.querySelector('[role="img"]');
    expect(img?.getAttribute("aria-label")).toMatch(/No measurement/);
    expect(container.textContent).not.toMatch(/\b0%/);
  });
});
