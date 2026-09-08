// @vitest-environment jsdom
//
// The Repositories tab's new graphics, held to the /org redesign's accessibility contract
// (docs/ORG-UX-REDESIGN.md §2.6): every chart is a `role="img"` with a GENERATED title built from
// the same numbers the geometry is, dense ones carry an `sr-only` table equivalent, and no chart
// prints a value for a state that renders none.
//
// `window.matchMedia` is stubbed centrally in vitest.setup.dom.js — nothing per-file here.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { FleetScoreShape } from "./FleetScoreShape";
import { fleetScoreShape } from "./fleetShape";
import { SegmentDumbbell } from "./SegmentDumbbell";
import { SegmentMaturityGrid } from "./SegmentMaturityGrid";
import { headlinePairs, segmentMatrixRows } from "./segmentViz";
import { FleetDecayScatter } from "./context-health/FleetDecayScatter";
import { decayField } from "./context-health/contextDecayViz";
import type { RepoContextRow } from "./context-health/contextHealthModel";
import type { SegmentComparison, SegmentSummary } from "@/lib/db";

const repo = (overall: number | null) => ({ latest: overall == null ? null : { overall } });

const summary = (over: Partial<SegmentSummary> & { name: string }): SegmentSummary =>
  ({
    id: over.name,
    name: over.name,
    repoCount: 2,
    scannedCount: 2,
    avgOverall: 60,
    avgAdoption: 55,
    avgRigor: 65,
    posture: "balanced",
    dimAverages: [],
    ...over,
  }) as SegmentSummary;

const ctxRow = (over: Partial<RepoContextRow> & { fullName: string }): RepoContextRow => ({
  name: over.fullName,
  scanned: true,
  assessed: true,
  present: true,
  primaryPath: "CLAUDE.md",
  ageDays: 5,
  commitsSinceEdit: 40,
  windowCapped: false,
  potency: 60,
  halfLifeDays: 20,
  quality: 70,
  refsTotal: 0,
  deadRefs: [],
  score: 70,
  commitsPerWeek: 4,
  band: "aging",
  verdict: "",
  ...over,
});

describe("FleetScoreShape", () => {
  it("draws the fleet's spread and names its own numbers", () => {
    render(<FleetScoreShape shape={fleetScoreShape([repo(20), repo(50), repo(90), repo(null)])} />);
    const plot = screen.getByRole("img", { name: /Fleet overall score/ });
    expect(plot.querySelector("[data-median]")).toBeTruthy();
    expect(plot.getAttribute("aria-label")).toMatch(/median 50/);
    // The unscanned repo is counted beside the plot, never inside it.
    expect(screen.getByText(/unscanned/)).toBeTruthy();
    expect(plot.getAttribute("aria-label")).toMatch(/minimum 20/);
  });

  it("refuses to draw a spread over a single observation", () => {
    render(<FleetScoreShape shape={fleetScoreShape([repo(70), repo(null)])} />);
    expect(screen.queryByRole("img", { name: /Fleet overall score/ })).toBeNull();
    expect(screen.getByText(/spread needs at least two/)).toBeTruthy();
  });
});

describe("FleetDecayScatter", () => {
  it("plots one dot per measured repo and a median decay curve", () => {
    const field = decayField([
      ctxRow({ fullName: "a/x", potency: 50, commitsSinceEdit: 100 }),
      ctxRow({ fullName: "a/y", potency: 25, commitsSinceEdit: 200 }),
    ]);
    render(<FleetDecayScatter field={field} />);
    const plot = screen.getByRole("img", { name: /Fleet context decay/ });
    expect(plot.querySelectorAll("[data-point]")).toHaveLength(2);
    expect(plot.querySelector("[data-curve]")).toBeTruthy();
    // The sr-only equivalent is built from the same points.
    const table = screen.getByRole("table");
    expect(within(table).getByRole("row", { name: /a\/x/ }).textContent).toMatch(/50%/);
  });

  it("counts the unmeasurable repos beside the plot instead of plotting them at zero", () => {
    const field = decayField([
      ctxRow({ fullName: "a/x", potency: 50, commitsSinceEdit: 100 }),
      ctxRow({ fullName: "a/none", present: false, potency: null, commitsSinceEdit: null, band: "absent" }),
      ctxRow({ fullName: "a/old", assessed: false, present: false, potency: null, commitsSinceEdit: null, band: null }),
    ]);
    render(<FleetDecayScatter field={field} />);
    expect(screen.getByRole("img", { name: /Fleet context decay/ }).querySelectorAll("[data-point]")).toHaveLength(1);
    expect(screen.getByText(/no guidance file/)).toBeTruthy();
    expect(screen.getByText(/not assessed/)).toBeTruthy();
  });
});

describe("SegmentDumbbell", () => {
  const cmp = (b: SegmentSummary): SegmentComparison => ({
    a: summary({ name: "platform" }),
    b,
    deltas: { overall: 60 - b.avgOverall, adoption: 55 - b.avgAdoption, rigor: 65 - b.avgRigor },
    dimDeltas: [],
  });

  it("draws both marks and the span between them", () => {
    render(
      <SegmentDumbbell
        rows={headlinePairs(cmp(summary({ name: "legacy", avgOverall: 30, avgAdoption: 25, avgRigor: 35 })))}
        aName="platform"
        bName="legacy"
        title="Headline metrics"
      />,
    );
    const plot = screen.getByRole("img", { name: /Headline metrics/ });
    expect(plot.querySelectorAll("[data-a]")).toHaveLength(3);
    expect(plot.querySelectorAll("[data-b]")).toHaveLength(3);
    expect(plot.querySelectorAll("[data-span]")).toHaveLength(3);
  });

  it("draws NO mark for a side with no scanned repo, and says so accessibly", () => {
    render(
      <SegmentDumbbell
        rows={headlinePairs(cmp(summary({ name: "new", scannedCount: 0, avgOverall: 0, avgAdoption: 0, avgRigor: 0 })))}
        aName="platform"
        bName="new"
        title="Headline metrics"
      />,
    );
    const plot = screen.getByRole("img", { name: /Headline metrics/ });
    expect(plot.querySelectorAll("[data-b]")).toHaveLength(0);
    expect(plot.querySelectorAll("[data-span]")).toHaveLength(0);
    expect(plot.getAttribute("aria-label")).toMatch(/new no scanned repo/);
    expect(plot.getAttribute("aria-label")).toMatch(/never as a zero/);
  });
});

describe("SegmentMaturityGrid", () => {
  it("hatches an unscanned segment and prints no number in it", () => {
    render(
      <SegmentMaturityGrid
        summaries={[summary({ name: "platform" }), summary({ name: "new", scannedCount: 0, avgOverall: 0, avgAdoption: 0, avgRigor: 0 })]}
      />,
    );
    const grid = screen.getByRole("img", { name: /Segment maturity/ });
    expect(grid.querySelector('[data-cell="new:Overall"]')?.getAttribute("data-state")).toBe("not-judged");
    expect(grid.querySelectorAll("[data-score]")).toHaveLength(3); // platform's three, and only those
    expect(segmentMatrixRows([summary({ name: "new", scannedCount: 0 })])[0]!.cells[0]!.score).toBeUndefined();
  });
});
