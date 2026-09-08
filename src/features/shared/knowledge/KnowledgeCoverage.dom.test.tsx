// @vitest-environment jsdom
//
// The tab's first sight. Three things this proves: the panel opens on a SHAPE, a bundle the registry
// declares but this Ascent never resolved renders as a dashed cell carrying NO numeral, and the
// judged axis goes hatched (no map) or void (never swept) instead of printing a zero.
//
// `window.matchMedia` is stubbed centrally in vitest.setup.dom.js — MatrixGrid reads it.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { fixtureKnowledgeView } from "@/lib/org/knowledge-view.fixture";
import { KnowledgeCoverage } from "./KnowledgeCoverage";

const view = fixtureKnowledgeView("acme");
const cell = (id: string, axis: string) => document.querySelector(`[data-cell="${id}:${axis}"]`) as SVGGElement | null;

describe("KnowledgeCoverage", () => {
  it("draws one row per bundle, with the axes as columns", () => {
    render(<KnowledgeCoverage view={view} />);
    const svg = screen.getByRole("img", { name: /Coverage of 2 knowledge bundles/ });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    for (const d of view.domains) for (const axis of ["Mirrored", "Routable", "Judged"]) expect(cell(d.name, axis)).toBeTruthy();
  });

  it("renders a declared-but-never-resolved bundle as `declared` and prints no number in it", () => {
    render(<KnowledgeCoverage view={view} />);
    const mirrored = cell("llm-observability", "Mirrored")!;
    expect(mirrored.getAttribute("data-state")).toBe("declared");
    expect(mirrored.querySelector("[data-score]")).toBeNull();
    // The bundle that WAS mirrored keeps its measurement.
    const measured = cell("software-engineering", "Mirrored")!;
    expect(measured.getAttribute("data-state")).toBe("measured");
    expect(measured.querySelector("[data-score]")).toBeTruthy();
  });

  it("voids the judged axis when the fleet was never swept, and hatches it when no repo has a map", () => {
    const { unmount } = render(<KnowledgeCoverage view={{ ...view, sweep: { ...view.sweep, lastAt: null } }} />);
    const voided = cell("software-engineering", "Judged")!;
    expect(voided.getAttribute("data-state")).toBe("missing");
    expect(voided.querySelector("[data-mark]")).toBeNull();
    expect(voided.querySelector("[data-score]")).toBeNull();
    unmount();

    render(<KnowledgeCoverage view={{ ...view, repos: view.repos.map((r) => ({ ...r, hasMap: false })) }} />);
    const hatched = cell("software-engineering", "Judged")!;
    expect(hatched.getAttribute("data-state")).toBe("not-judged");
    expect(hatched.querySelector("[data-score]")).toBeNull();
  });

  it("carries the sweep window as a unit line, and never a sentence about the picture", () => {
    render(<KnowledgeCoverage view={view} />);
    const unit = screen.getByText(/subjects · swept /);
    expect(unit.textContent!.length).toBeLessThanOrEqual(60);
  });
});
