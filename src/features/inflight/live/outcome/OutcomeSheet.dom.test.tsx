// @vitest-environment jsdom
//
// THE SHEET IS A SHEET. Three things are load-bearing and all three were the point of the rebuild:
//   - the row axis is FIRST-CLASS ROWS — a project header row (`th scope="colgroup"`), then one
//     `th scope="row"` per gap, the project name never repeated and the gaps never nested in one cell;
//   - a gap worked in two runs is ONE row with a filled cell in each of those columns and BLANK cells
//     elsewhere — the blanks are what make "when did this get done" readable;
//   - width is disclosure: every column has a keyboard-operable resize separator, and there is NO
//     "details" toggle anywhere.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OutcomeSheet } from "./OutcomeSheet";
import { fixture } from "./outcome.fixture";

const sheet = (canReview = true) =>
  render(<OutcomeSheet matrix={fixture} slug="acme" selectedId="run-3" onOpen={vi.fn()} canReview={canReview} onReview={vi.fn()} />);

// UAT PRIYA-L1-704. The per-lane ¢/point was computed, serialized and shipped to the browser, and
// `grep -rn "\.economics" src/features src/app` returned zero hits — the only ¢/point on the page was
// the org-wide average, which is exactly what hid a lane spending $10.19 for 0 verified points.
describe("the sheet says what each run spent on each repo", () => {
  it("prints the rate on a priced, measured cell", () => {
    sheet();
    expect(screen.getByText("1.50¢/pt")).toBeTruthy();
  });

  it("prints spend beside a ZERO rather than omitting it, and tones it as a warning", () => {
    sheet();
    const zero = screen.getByText("$10.19 · 0 pts");
    expect(zero.className).toContain("text-warn");
    expect(zero.getAttribute("title")).toMatch(/bought no verified maturity point/);
  });

  // A cell whose payload carried no economics says nothing at all — a "0" there would be a claim.
  it("says nothing for a cell with no economics", () => {
    sheet();
    const row = screen.getAllByText("acme/web-app")[0]!.closest("tr")!;
    expect(row.querySelectorAll('[data-testid="cell-economics"]')).toHaveLength(0);
  });
});

describe("the outcome sheet's row axis", () => {
  it("names each project ONCE, as a group header row, and gives every gap its own row", () => {
    sheet();
    expect(screen.getAllByText("acme/payments-api")).toHaveLength(1);
    const gap = screen.getByRole("rowheader", { name: /Added a coverage gate to CI/ });
    expect(gap.tagName).toBe("TH");
    // Five deliverables on the latest payments run → five gap rows, not one cell holding a list.
    expect(screen.getAllByRole("rowheader").length).toBeGreaterThanOrEqual(5);
  });

  it("leaves the cell blank for a run that did not touch the gap", () => {
    sheet();
    const row = screen.getByRole("rowheader", { name: /Improved commit hygiene/ }).closest("tr")!;
    const cells = row.querySelectorAll("td");
    // Runs 1 and 2 never worked it; run 3 did.
    expect(cells[0]!.textContent).toBe("");
    expect(cells[1]!.textContent).toBe("");
    expect(cells[2]!.textContent).toContain("Improved commit hygiene");
  });

  it("puts a run in every column header, with the run's own lift", () => {
    sheet();
    expect(screen.getByRole("button", { name: /Run 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Run 3/ })).toBeTruthy();
  });

  it("offers the owner a ✓/✕ on each gap cell, and nothing to a viewer who cannot rule", () => {
    const { unmount } = sheet(true);
    expect(screen.getAllByLabelText(/^Approve /).length).toBeGreaterThan(0);
    unmount();
    render(<OutcomeSheet matrix={fixture} slug="acme" selectedId={null} onOpen={vi.fn()} />);
    expect(screen.queryAllByLabelText(/^Approve /)).toHaveLength(0);
  });

  it("has no `details` toggle — the evidence rides in the title and in the width", () => {
    sheet();
    expect(screen.queryByText("details")).toBeNull();
    expect(screen.queryByText("less")).toBeNull();
  });
});

describe("column widths", () => {
  it("gives every column — the frozen label column included — a keyboard-operable separator", () => {
    sheet();
    const handles = screen.getAllByRole("separator");
    expect(handles).toHaveLength(fixture.columns.length + 1);
    const label = screen.getByLabelText("Resize the project and gap column");
    const before = Number(label.getAttribute("aria-valuenow"));
    fireEvent.keyDown(label, { key: "ArrowRight" });
    expect(Number(screen.getByLabelText("Resize the project and gap column").getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  });

  it("clamps a drag to the min width rather than letting a column vanish", () => {
    sheet();
    const handle = screen.getByLabelText("Resize the run 1 column");
    for (let i = 0; i < 20; i += 1) fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(Number(screen.getByLabelText("Resize the run 1 column").getAttribute("aria-valuenow"))).toBe(96);
  });
});

describe("an unavailable baseline on a run's row", () => {
  it("is ONE WORD on the project header row, with the guard's note on hover", () => {
    sheet();
    const word = screen.getByTestId("cell-baseline-unavailable");
    // `no baseline`, never `baseline red`: the badge is read at a glance and out of context, and
    // the old word was routinely read as a claim that the repository is failing.
    expect(word.textContent).toBe("no baseline");
    expect(word.textContent).not.toContain("red");
    expect(word.getAttribute("title")).toContain("NO BASELINE");
    // It belongs to the repo whose lane measured it, on that repo's own header row.
    expect(word.closest("tr")!.textContent).toContain("acme/docs-site");
  });

  it("is a WORD, not a panel — no extra row, no expander, no heading", () => {
    sheet();
    // Exactly one repo in the fixture is red; the other three header rows say nothing.
    expect(screen.getAllByTestId("cell-baseline-unavailable")).toHaveLength(1);
    expect(screen.queryByText(/degradation guard/i)).toBeNull();
  });
});
