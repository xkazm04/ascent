// @vitest-environment jsdom
//
// The three prototype directions render the shaped fixture end to end: every direction mounts, the
// registry's real nouns reach the DOM, a cell can be picked into the composer, and the subject reader
// opens. A direction that throws on the fixture would otherwise be found by the operator in the
// browser, which is the expensive place to find it.

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { fixtureKnowledgeView } from "@/lib/org/knowledge-view.fixture";
import { KNOWLEDGE_CELL_STATES } from "@/lib/org/knowledge-shape";
import { KnowledgeAtlas } from "./KnowledgeAtlas";
import { KnowledgeBoard } from "./KnowledgeBoard";
import { KnowledgeLoom } from "./KnowledgeLoom";
import { KnowledgeSwitcher } from "./KnowledgeSwitcher";

const view = fixtureKnowledgeView("acme");

describe("the shaped fixture", () => {
  it("is dense — one cell per subject × swept repo — and reaches every state and stage", () => {
    expect(view.cells).toHaveLength(view.subjects.length * view.repos.length);
    const states = new Set(view.cells.map((c) => c.state));
    for (const s of KNOWLEDGE_CELL_STATES) expect(states.has(s), `state ${s} never reached`).toBe(true);
    expect(new Set(view.repos.map((r) => r.stage))).toEqual(new Set(["populate", "map", "conform", "current"]));
    expect(view.cells.some((c) => c.stale)).toBe(true);
  });
});

describe("Atlas", () => {
  it("renders the registry tree with real category titles and opens the subject reader", () => {
    render(<KnowledgeAtlas view={view} />);
    expect(screen.getByRole("navigation", { name: "Registry tree" })).toBeTruthy();
    expect(screen.getAllByText("LLM & agent engineering").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /agent-memory/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("agent-memory")).toBeTruthy();
    expect(within(dialog).getByText(/Consulted when/)).toBeTruthy();
  });
});

describe("Loom", () => {
  it("renders every mapped repo as a column and threads a picked cell into the composer", () => {
    render(<KnowledgeLoom view={view} />);
    const mapped = view.repos.filter((r) => r.hasMap);
    expect(screen.getAllByRole("columnheader")).toHaveLength(mapped.length + 1);
    const pickable = screen.getAllByRole("button", { pressed: false }).filter((b) => b.getAttribute("title")?.includes("Unjudged"));
    expect(pickable.length).toBeGreaterThan(0);
    fireEvent.click(pickable[0]!);
    // The picked subject appears as a removable chip in the composer.
    expect(screen.getAllByTitle("Remove from the brief")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Copy brief" })).toBeTruthy();
  });
});

describe("Board", () => {
  it("places every repo in exactly one stage column and opens a repo sheet", () => {
    render(<KnowledgeBoard view={view} />);
    for (const label of ["Needs a context map", "Needs a registry map", "Verdicts owed", "Current"]) {
      expect(screen.getByRole("region", { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: /^api/ }));
    expect(screen.getByRole("region", { name: "acme/api sheet" })).toBeTruthy();
  });
});

describe("Switcher", () => {
  it("keeps the baseline as the default tab and swaps to a direction on click", () => {
    render(
      <KnowledgeSwitcher fixture={view}>
        <p>baseline ledger</p>
      </KnowledgeSwitcher>,
    );
    expect(screen.getByText("baseline ledger")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Loom" }));
    expect(screen.queryByText("baseline ledger")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
  });
});
