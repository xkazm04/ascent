// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MatrixGrid, type MatrixRow } from "./MatrixGrid";
import { DECLARED_DASH, HATCH_ID, STATE_LABEL } from "./states";

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

describe("MatrixGrid accessibility", () => {
  it("names every subject and axis from the same cells it paints", () => {
    render(<MatrixGrid axes={AXES} rows={ROWS} title="Practice rollout" />);
    const name = screen.getByRole("img", { name: /Practice rollout/i }).getAttribute("aria-label")!;
    expect(name).toContain("acme/api — Declared: declared, not enforced 80");
    expect(name).toContain("Enforced: not judged");
    expect(name).toContain("A hatched cell was not judged");
  });

  it("renders an sr-only table with a column per axis and a row per subject", () => {
    render(<MatrixGrid axes={AXES} rows={ROWS} title="Practice rollout" />);
    expect(screen.getByRole("table", { name: /Practice rollout/i })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(AXES.length + 1);
    for (const r of ROWS) expect(screen.getByRole("rowheader", { name: r.label })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: `${STATE_LABEL.measured} — 62` })).toBeInTheDocument();
  });
});

describe("MatrixGrid cell encodings", () => {
  it("hatches a not-judged cell and prints no score in it", () => {
    const { container } = render(<MatrixGrid axes={AXES} rows={ROWS} />);
    const cell = container.querySelector('[data-cell="a:Enforced"]')!;
    expect(cell.querySelector("[data-mark]")!.getAttribute("fill")).toBe(`url(#${HATCH_ID})`);
    expect(cell.querySelector("[data-score]")).toBeNull();
  });

  it("leaves a missing cell empty but framed — an absence you can point at", () => {
    const { container } = render(<MatrixGrid axes={AXES} rows={ROWS} />);
    const cell = container.querySelector('[data-cell="b:Observed"]')!;
    expect(cell.querySelector("[data-mark]")).toBeNull();
    expect(cell.querySelector("[data-score]")).toBeNull();
    // The frame is always drawn so the void has a location in the grid.
    expect(cell.querySelector("rect")).not.toBeNull();
  });

  it("dashes a declared cell and rings a decided one in the accent", () => {
    const { container } = render(<MatrixGrid axes={AXES} rows={ROWS} />);
    expect(container.querySelector('[data-cell="a:Declared"] [data-mark]')!.getAttribute("stroke-dasharray")).toBe(DECLARED_DASH);
    const decided = container.querySelector('[data-cell="b:Declared"] [data-mark]')!;
    expect(decided.getAttribute("stroke")).toBe("var(--color-accent)");
    expect(decided.getAttribute("stroke-width")).toBe("2");
  });

  it("strikes a superseded cell through while keeping its value readable", () => {
    const { container } = render(<MatrixGrid axes={AXES} rows={ROWS} />);
    const cell = container.querySelector('[data-cell="b:Enforced"]')!;
    expect(cell.querySelector("[data-strike]")).not.toBeNull();
    expect(cell.querySelector("[data-score]")!.textContent).toBe("40");
  });

  it("pads a short row with voids rather than shifting the remaining cells left", () => {
    const { container } = render(<MatrixGrid axes={AXES} rows={[{ id: "c", label: "acme/cli", cells: [{ state: "measured", score: 10 }] }]} />);
    expect(container.querySelector('[data-cell="c:Enforced"]')!.getAttribute("data-state")).toBe("missing");
  });

  it("degrades to a labelled placeholder with no rows or no axes", () => {
    const { container } = render(<MatrixGrid axes={[]} rows={ROWS} title="Practice rollout" />);
    expect(screen.getByRole("img", { name: /no matrix data/i })).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });
});
