// @vitest-environment jsdom
//
// The void-vs-zero guards, pinned where they are actually READ — in the DOM.
//
// Three absences used to reach this tab as numbers: an unscanned stack's sentinel `avgOverall` 0 in
// the rail, a dimension a stack carries no average for plotted at the radar's centre, and that same
// stack folded into a fleet spread whose minimum then read 0. Each test below fails if the number
// comes back.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { StackProfiles } from "./StackProfiles";
import { StackSpreadStrip } from "./StackSpreadStrip";
import { STACK_SCOPE } from "./analysisScope";
import type { SegmentSummary } from "@/lib/db";

const DIMS = ["D1", "D2", "D3"];

const stack = (over: Partial<SegmentSummary>): SegmentSummary => ({
  id: "fe",
  name: "Frontend",
  repoCount: 3,
  scannedCount: 3,
  avgOverall: 62,
  avgAdoption: 60,
  avgRigor: 64,
  posture: "pragmatist",
  dimAverages: DIMS.map((d) => ({ dimId: d, avg: 62 })),
  ...over,
});

const profiles = (stacks: SegmentSummary[], active: string[]) =>
  render(
    <StackProfiles
      org="acme"
      stacks={stacks}
      dims={DIMS}
      scope={STACK_SCOPE}
      active={new Set(active)}
      allActive={active.length === stacks.length}
      hovered={null}
      onToggle={() => {}}
      onToggleAll={() => {}}
      onHover={() => {}}
    />,
  );

describe("StackProfiles rail", () => {
  it("never prints a score for a stack nobody has scanned", () => {
    // summarizeScopedRepos averages an empty array, so this stack arrives with avgOverall 0.
    const { container } = profiles([stack({ id: "z", name: "Mobile", scannedCount: 0, avgOverall: 0 })], []);
    expect(screen.getByText("Mobile")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    // …and says what it is instead: the hatched not-judged swatch, plus its caveat.
    expect(container.querySelector('[aria-label^="Not judged"]')).toBeTruthy();
    expect(screen.getByText(/never scanned/)).toBeTruthy();
  });

  it("keeps printing a real measured score", () => {
    profiles([stack({ avgOverall: 62 })], []);
    expect(screen.getByText("62")).toBeTruthy();
  });

  it("legends the missing state only when a plotted profile actually has a hole", () => {
    const whole = stack({ id: "a", name: "Whole" });
    const { unmount } = profiles([whole], ["a"]);
    expect(screen.queryByText("No measurement")).toBeNull();
    unmount();

    const holed = stack({ id: "b", name: "Holed", dimAverages: [{ dimId: "D1", avg: 70 }] });
    profiles([holed], ["b"]);
    // Two sightings on purpose: the legend row and the sr-only table cell, both from STATE_LABEL.
    expect(screen.getAllByText("No measurement").length).toBeGreaterThan(0);
  });

  it("draws no vertex at the centre for an unmeasured dimension", () => {
    const holed = stack({ id: "b", name: "Holed", dimAverages: [{ dimId: "D1", avg: 70 }, { dimId: "D2", avg: 50 }] });
    const { container } = profiles([holed], ["b"]);
    const paths = [...container.querySelectorAll("path")].map((p) => p.getAttribute("d") ?? "");
    // 130,130 is the radar's centre — where `?? 0` used to plant the missing axis.
    expect(paths.some((d) => d.includes("130.0 130.0"))).toBe(false);
    // A broken ring is never filled: the enclosed area would be invented out of the missing axis.
    expect(paths.every((d) => !d.includes("Z"))).toBe(true);
  });

  it("gives the radar an sr-only table that marks the hole as an absence", () => {
    const holed = stack({ id: "b", name: "Holed", dimAverages: [{ dimId: "D1", avg: 70 }] });
    profiles([holed], ["b"]);
    const table = screen.getByRole("table", { hidden: true });
    expect(table.textContent).toContain("No measurement");
    expect(table.textContent).toContain("70");
  });
});

describe("StackSpreadStrip", () => {
  it("excludes unscanned stacks from the quartiles instead of floor-ing the fleet at 0", () => {
    render(
      <StackSpreadStrip
        stacks={[
          stack({ id: "a", avgOverall: 40 }),
          stack({ id: "b", avgOverall: 80 }),
          stack({ id: "z", scannedCount: 0, avgOverall: 0 }),
        ]}
      />,
    );
    const chart = screen.getByRole("img", { name: /Stack maturity/ });
    expect(chart.getAttribute("aria-label")).toContain("minimum 40");
    expect(chart.getAttribute("aria-label")).not.toContain("minimum 0");
    expect(screen.getByText("× 1")).toBeTruthy();
  });

  it("draws nothing rather than a degenerate box below two measured stacks", () => {
    const { container } = render(<StackSpreadStrip stacks={[stack({}), stack({ id: "z", scannedCount: 0, avgOverall: 0 })]} />);
    expect(container.firstChild).toBeNull();
  });
});
