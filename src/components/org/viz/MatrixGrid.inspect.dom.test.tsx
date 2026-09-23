// @vitest-environment jsdom
// MatrixGrid's inspect mode: one tab stop, arrows walk the cells, a tap or focus pins a VISIBLE
// readout (text, not a title attribute) that a hover-less reader can reach.
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MatrixGrid, type MatrixRow } from "./MatrixGrid";
import { matrixAriaLabel } from "./matrixShared";
import { STATE_HINT } from "./states";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

const AXES = ["Declared", "Observed", "Enforced"];
const ROWS: MatrixRow[] = [
  { id: "a", label: "acme/api", cells: [{ state: "declared", score: 80 }, { state: "measured", score: 62 }, { state: "not-judged" }] },
  { id: "b", label: "acme/web", cells: [{ state: "decided", score: 91 }, { state: "missing" }, { state: "superseded", score: 40 }] },
];

const cell = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-cell="${key}"]`)!;
const readout = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-readout]");

describe("MatrixGrid inspect mode", () => {
  it("is a named grid: role='grid' carrying the accessible name matrixAriaLabel produces", () => {
    render(<MatrixGrid axes={AXES} rows={ROWS} title="Practice rollout" />);
    const grid = screen.getByRole("grid", { name: /Practice rollout/i });
    expect(grid.getAttribute("aria-label")).toBe(matrixAriaLabel("Practice rollout", AXES, ROWS));
    expect(screen.getAllByRole("gridcell", { name: /acme\/api · /i })).toHaveLength(AXES.length);
  });

  it("keeps the no-data placeholder a role='img' named '...no matrix data'", () => {
    render(<MatrixGrid axes={AXES} rows={[]} title="Practice rollout" />);
    expect(screen.getByRole("img", { name: "Practice rollout: no matrix data" })).toBeInTheDocument();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("exposes exactly one tab stop and moves it with the arrow keys", () => {
    const { container } = render(<MatrixGrid axes={AXES} rows={ROWS} />);
    const cells = [...container.querySelectorAll<HTMLElement>("[data-cell]")];
    expect(cells.filter((c) => c.tabIndex === 0)).toHaveLength(1);
    expect(cells.filter((c) => c.tabIndex === -1)).toHaveLength(cells.length - 1);

    const first = cells.find((c) => c.tabIndex === 0)!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const next = cell(container, "a:Observed");
    expect(document.activeElement).toBe(next);
    expect(next.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);

    fireEvent.keyDown(next, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell(container, "b:Observed"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(cell(container, "b:Enforced"));
  });

  it("a tap pins a visible text readout (subject, axis, state, hint); Escape clears it", () => {
    const { container } = render(<MatrixGrid axes={AXES} rows={ROWS} />);
    expect(readout(container)?.textContent ?? "").not.toContain("acme/api");

    fireEvent.click(cell(container, "a:Enforced"));
    const pinned = readout(container)!;
    expect(pinned.hasAttribute("title")).toBe(false);
    expect(pinned.textContent).toContain("acme/api");
    expect(pinned.textContent).toContain("Enforced");
    expect(pinned.textContent).toContain("Not judged");
    expect(pinned.textContent).toContain(STATE_HINT["not-judged"]);

    fireEvent.keyDown(cell(container, "a:Enforced"), { key: "Escape" });
    expect(readout(container)?.textContent ?? "").not.toContain("acme/api");
  });

  it("announces the readout politely", () => {
    const { container } = render(<MatrixGrid axes={AXES} rows={ROWS} />);
    fireEvent.click(cell(container, "b:Declared"));
    expect(readout(container)!.closest("[aria-live]")!.getAttribute("aria-live")).toBe("polite");
  });

  it("walks onto a padded void cell and reads it as 'No measurement' with no numeral", () => {
    const { container } = render(
      <MatrixGrid axes={AXES} rows={[{ id: "c", label: "acme/cli", cells: [{ state: "measured", score: 10 }] }]} />,
    );
    const start = cell(container, "c:Declared");
    start.focus();
    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell(container, "c:Enforced"));
    const text = readout(container)!.textContent!;
    expect(text).toContain("acme/cli · Enforced: No measurement");
    expect(text).not.toMatch(/\d/);
  });

  it("guard: the visual grid adds no columnheader or rowheader beside the sr-only table's", () => {
    render(<MatrixGrid axes={AXES} rows={ROWS} title="Practice rollout" />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(AXES.length + 1);
    for (const r of ROWS) expect(screen.getAllByRole("rowheader", { name: r.label })).toHaveLength(1);
  });
});
