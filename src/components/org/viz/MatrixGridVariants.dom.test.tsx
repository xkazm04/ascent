// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MatrixGridLedger } from "./MatrixGridLedger";
import { MatrixGridStrata } from "./MatrixGridStrata";
import { type MatrixRow } from "./matrixShared";
import { DECLARED_DASH, HATCH_ID, STATE_LABEL } from "./states";

// The /prototype variants lay the matrix out in HTML so type can use the semantic scale — but the
// epistemic contract is the baseline's, and these pins are what a variant must keep to be judged.

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

const AXES = ["Declared", "Observed", "Enforced"];
const ROWS: MatrixRow[] = [
  { id: "a", label: "acme/api", cells: [{ state: "declared", score: 80 }, { state: "measured", score: 62 }, { state: "not-judged", score: 0 }] },
  { id: "b", label: "acme/web", cells: [{ state: "decided", score: 91 }, { state: "missing", score: 0 }, { state: "superseded", score: 40 }] },
];

describe.each([
  ["Ledger", MatrixGridLedger],
  ["Strata", MatrixGridStrata],
])("MatrixGrid%s keeps the state contract", (_name, Grid) => {
  it("hatches a not-judged cell and leaves a void empty — neither prints a numeral, even for a literal 0", () => {
    const { container } = render(<Grid axes={AXES} rows={ROWS} title="Practice rollout" />);
    const hatched = container.querySelector('[data-cell="a:Enforced"]')!;
    expect(hatched.querySelector("[data-mark]")!.getAttribute("fill")).toBe(`url(#${HATCH_ID})`);
    expect(hatched.querySelector("[data-score]")).toBeNull();
    const voidCell = container.querySelector('[data-cell="b:Observed"]')!;
    expect(voidCell.querySelector("[data-mark]")).toBeNull();
    expect(voidCell.querySelector("[data-score]")).toBeNull();
    expect(voidCell.querySelector("rect")).not.toBeNull(); // framed: an absence you can point at
  });

  it("dashes declared, rings decided in the accent, strikes superseded", () => {
    const { container } = render(<Grid axes={AXES} rows={ROWS} />);
    expect(container.querySelector('[data-cell="a:Declared"] [data-mark]')!.getAttribute("stroke-dasharray")).toBe(DECLARED_DASH);
    const decided = container.querySelector('[data-cell="b:Declared"] [data-mark]')!;
    expect(decided.getAttribute("stroke")).toBe("var(--color-accent)");
    expect(decided.getAttribute("stroke-width")).toBe("2");
    const struck = container.querySelector('[data-cell="b:Enforced"]')!;
    expect(struck.querySelector("[data-strike]")).not.toBeNull();
    expect(struck.querySelector("[data-score]")!.textContent).toBe("40");
  });

  it("prints no viewBox-scaled text: every glyph is HTML in the type-* scale", () => {
    const { container } = render(<Grid axes={AXES} rows={ROWS} />);
    expect(container.querySelector("svg text")).toBeNull();
    expect(container.querySelectorAll(".type-label, .type-mono-sm, .type-figure, .type-micro, .type-body-sm").length).toBeGreaterThan(0);
  });

  it("keeps the accessible table and pads a short row with voids", () => {
    render(<Grid axes={AXES} rows={[{ id: "c", label: "acme/cli", cells: [{ state: "measured", score: 10 }] }]} title="Practice rollout" />);
    expect(screen.getByRole("table", { name: /Practice rollout/i })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(AXES.length + 1);
    expect(screen.getByRole("rowheader", { name: "acme/cli" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: `${STATE_LABEL.measured} — 10` })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: STATE_LABEL.missing })).toHaveLength(2);
  });

  it("degrades to the labelled placeholder with no axes", () => {
    const { container } = render(<Grid axes={[]} rows={ROWS} title="Practice rollout" />);
    expect(screen.getByRole("img", { name: /no matrix data/i })).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });
});
