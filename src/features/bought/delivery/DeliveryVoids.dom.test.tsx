// @vitest-environment jsdom
//
// "An em dash is a missing measurement, not a zero" was the single most important caveat on the
// Delivery tab and the one prose could never enforce. These pin the two drawings that now enforce it:
// the trend line BREAKS at an unmeasured day, and the review-coverage strip draws an unmeasured repo
// as an empty dashed column rather than a zero-height bar.
//
// The assertion that matters in both is negative: no numeral, and no geometry, at zero.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DeliveryTrendPanel } from "./DeliveryTrendPanel";
import { ReviewCoverageStrip, orderByRisk } from "./ReviewCoverageStrip";
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

describe("ReviewCoverageStrip — the risk ordering, drawn", () => {
  const rows = [
    { name: "web", rate: 40 },
    { name: "api", rate: 95 },
    { name: "cli", rate: 62 },
    { name: "docs", rate: null },
  ];

  it("orders worst measured first and never ranks an unmeasured repo as a zero", () => {
    expect(orderByRisk(rows).map((r) => r.name)).toEqual(["web", "cli", "api", "docs"]);
  });

  it("draws an unmeasured repo as a void column, not a zero-height bar", () => {
    const { container } = render(<ReviewCoverageStrip rows={rows} target={80} />);
    const docs = container.querySelector('[data-repo="docs"]');
    expect(docs?.getAttribute("data-state")).toBe("missing");
    expect(docs?.getAttribute("fill")).toBe("none");
    // A measured repo, by contrast, is painted.
    expect(container.querySelector('[data-repo="web"]')?.getAttribute("data-state")).toBe("measured");
  });

  it("brackets the below-target tail so 'riskiest first' is seen rather than stated", () => {
    const { container } = render(<ReviewCoverageStrip rows={rows} target={80} />);
    // web (40) and cli (62) are under the 80% target; api (95) is not; docs has no measurement.
    expect(container.querySelector("[data-tail]")?.getAttribute("data-tail")).toBe("2");
    expect(container.textContent).toMatch(/2 below target/);
  });

  it("carries an sr-only equivalent built from the same data the geometry is", () => {
    const { container } = render(<ReviewCoverageStrip rows={rows} target={80} />);
    const table = container.querySelector("table.sr-only");
    expect(table?.textContent).toMatch(/No measurement/);
    expect(table?.textContent).toMatch(/40%/);
  });
});
