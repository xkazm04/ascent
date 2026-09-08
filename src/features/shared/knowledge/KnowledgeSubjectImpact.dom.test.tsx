// @vitest-environment jsdom
//
// The impact panel's two readings. Measured: the totals line survives and the magnitude is DRAWN,
// one bar per mapped repo. Unmeasured: no numeral appears anywhere — the old panel printed
// "0 contexts across 0 repos · 0 stale" for a fleet nobody had ever swept.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { fixtureKnowledgeView } from "@/lib/org/knowledge-view.fixture";
import { indexCells } from "./knowledgeModel";
import { KnowledgeSubjectImpact } from "./KnowledgeSubjectImpact";

const view = fixtureKnowledgeView("acme");
const subject = view.subjects.find((s) => s.slug === "agent-memory")!;
const cells = indexCells(view.cells);
const mapped = view.repos.filter((r) => r.hasMap);

describe("KnowledgeSubjectImpact", () => {
  it("draws one bar per mapped repository, painted from the cell's state", () => {
    render(<KnowledgeSubjectImpact view={view} subject={subject} cells={cells} />);
    expect(screen.getByRole("img", { name: new RegExp(`Contexts governed by ${subject.slug}`) })).toBeTruthy();
    expect(document.querySelectorAll("[data-impact]")).toHaveLength(mapped.length);
    for (const g of document.querySelectorAll("[data-impact]")) expect(g.getAttribute("data-state")).toBeTruthy();
  });

  it("keeps the totals line when the reading is measured", () => {
    render(<KnowledgeSubjectImpact view={view} subject={subject} cells={cells} />);
    expect(screen.getByText(/contexts across \d+ repos · \d+ stale$/)).toBeTruthy();
  });

  it("prints NO number at all when the fleet was never swept — a void, not a zero", () => {
    render(<KnowledgeSubjectImpact view={{ ...view, sweep: { ...view.sweep, lastAt: null } }} subject={subject} cells={cells} />);
    expect(screen.getByText(/impact not measured/)).toBeTruthy();
    expect(screen.queryByText(/contexts across/)).toBeNull();
    expect(screen.queryByText(/0 stale/)).toBeNull();
    expect(document.querySelectorAll("[data-impact]")).toHaveLength(0);
    // The demoted sentence is reachable, not printed.
    expect(screen.getByRole("button", { name: "Why: impact not measured" })).toBeTruthy();
  });

  it("prints no number when no repository carries a registry map either", () => {
    render(<KnowledgeSubjectImpact view={{ ...view, repos: view.repos.map((r) => ({ ...r, hasMap: false })) }} subject={subject} cells={cells} />);
    expect(screen.getByText(/impact not measured/)).toBeTruthy();
    expect(screen.queryByText(/contexts across/)).toBeNull();
  });
});
