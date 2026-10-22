// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetPack, type Omission } from "./BudgetPack";
import { HATCH_ID, STATE_LABEL } from "./states";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

const OMITTED: Omission[] = [
  { id: "budget", label: "over token budget", count: 9, state: "measured" },
  { id: "unjudged", label: "never judged", count: 4, state: "not-judged" },
  { id: "retired", label: "retired", count: 2, state: "superseded" },
];

describe("BudgetPack shows the losers", () => {
  it("names the packed fill AND every omission group", () => {
    render(<BudgetPack used={3800} budget={4000} unit=" tok" omissions={OMITTED} label="Recall budget" />);
    const name = screen.getByRole("img", { name: /Recall budget/i }).getAttribute("aria-label")!;
    expect(name).toContain("3800 tok of 4000 tok used");
    expect(name).toContain("15 omitted");
    expect(name).toContain("9 over token budget");
    expect(name).toContain("4 never judged");
  });

  it("renders an sr-only table with packed, budget and one row per reason", () => {
    render(<BudgetPack used={3800} budget={4000} omissions={OMITTED} label="Recall budget" />);
    expect(screen.getByRole("table", { name: /Recall budget/i })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Packed" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Budget" })).toBeInTheDocument();
    for (const o of OMITTED) expect(screen.getByRole("rowheader", { name: `Omitted: ${o.label}` })).toBeInTheDocument();
  });

  it("tints each omission block by its own state — the unjudged group hatches", () => {
    const { container } = render(<BudgetPack used={10} budget={20} omissions={OMITTED} />);
    expect(container.querySelector('[data-omission="unjudged"]')!.getAttribute("fill")).toBe(`url(#${HATCH_ID})`);
    expect(container.querySelector('[data-omission="retired"]')!.getAttribute("data-state")).toBe("superseded");
    expect(screen.getByRole("cell", { name: STATE_LABEL.superseded })).toBeInTheDocument();
  });

  it("sizes blocks by count — the biggest reason is the widest block", () => {
    const { container } = render(<BudgetPack used={10} budget={20} omissions={OMITTED} />);
    const w = (id: string) => Number(container.querySelector(`[data-omission="${id}"]`)!.getAttribute("width"));
    expect(w("budget")).toBeGreaterThan(w("unjudged"));
    expect(w("unjudged")).toBeGreaterThan(w("retired"));
  });

  it("never divides by a zero budget — the fill stays finite and the readout is an em dash", () => {
    const { container } = render(<BudgetPack used={12} budget={0} omissions={[]} />);
    const used = container.querySelector("[data-used]")!;
    expect(Number(used.getAttribute("width"))).toBe(0);
    expect(screen.getByRole("img", { name: /unstated budget/i })).toBeInTheDocument();
  });

  it("drops zero-count and non-finite reasons rather than drawing empty blocks", () => {
    const { container } = render(
      <BudgetPack used={5} budget={10} omissions={[{ id: "none", label: "nothing", count: 0, state: "measured" }, { id: "nan", label: "broken", count: Number.NaN, state: "measured" }]} />,
    );
    expect(container.querySelectorAll("[data-omission]")).toHaveLength(0);
    expect(screen.getByRole("img", { name: /Nothing was omitted/i })).toBeInTheDocument();
  });
});
