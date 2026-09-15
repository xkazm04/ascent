// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FlowRibbon, type FlowStage } from "./FlowRibbon";
import { STATE_LABEL, VOID_DASH } from "./states";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

const FULL: FlowStage[] = [
  { id: "spend", label: "Spend", value: 4200, unit: "$" },
  { id: "output", label: "Output", value: 310 },
  { id: "reviewed", label: "Reviewed", value: 190 },
];

describe("FlowRibbon accessibility", () => {
  it("names the chain from the same values the thicknesses come from", () => {
    render(<FlowRibbon stages={FULL} title="Unit economics" />);
    const name = screen.getByRole("img", { name: /Unit economics/i }).getAttribute("aria-label")!;
    expect(name).toContain("Spend 4200$");
    expect(name).toContain("Output 310");
    expect(name).toContain("Reviewed 190");
  });

  it("renders an sr-only table with a row per stage", () => {
    render(<FlowRibbon stages={FULL} title="Unit economics" />);
    expect(screen.getByRole("table", { name: /Unit economics/i })).toBeInTheDocument();
    for (const s of FULL) expect(screen.getByRole("rowheader", { name: s.label })).toBeInTheDocument();
  });
});

describe("FlowRibbon treats an absent stage as missing, never as zero", () => {
  const GAPPED: FlowStage[] = [
    { id: "spend", label: "Spend", value: 4200 },
    { id: "output", label: "Output", value: 310 },
    { id: "reviewed", label: "Reviewed", value: null },
  ];

  it("draws the unmeasured stage as a dashed void with no fill", () => {
    const { container } = render(<FlowRibbon stages={GAPPED} />);
    const stage = container.querySelector('[data-stage="reviewed"]')!;
    expect(stage.getAttribute("data-state")).toBe("missing");
    expect(stage.getAttribute("fill")).toBe("none");
    expect(stage.getAttribute("stroke-dasharray")).toBe(VOID_DASH);
  });

  it("prints an em dash for it, and no numeral", () => {
    const { container } = render(<FlowRibbon stages={GAPPED} />);
    const numerals = Array.from(container.querySelectorAll("svg text")).map((t) => t.textContent);
    expect(numerals).toContain("—");
    expect(numerals).not.toContain("0");
    expect(screen.getByRole("cell", { name: STATE_LABEL.missing })).toBeInTheDocument();
  });

  it("breaks the ribbon: the connector into a missing stage is not drawn", () => {
    const { container: gapped } = render(<FlowRibbon stages={GAPPED} />);
    expect(gapped.querySelectorAll("[data-connector]")).toHaveLength(1);

    const { container: full } = render(<FlowRibbon stages={FULL} />);
    expect(full.querySelectorAll("[data-connector]")).toHaveLength(2);
  });

  it("treats a NaN value the same way as null", () => {
    const { container } = render(
      <FlowRibbon stages={[{ id: "a", label: "A", value: 10 }, { id: "b", label: "B", value: Number.NaN }]} />,
    );
    expect(container.querySelector('[data-stage="b"]')!.getAttribute("data-state")).toBe("missing");
  });

  it("keeps every geometry attribute finite when every stage is zero", () => {
    const { container } = render(
      <FlowRibbon stages={[{ id: "a", label: "A", value: 0 }, { id: "b", label: "B", value: 0 }]} />,
    );
    for (const r of Array.from(container.querySelectorAll("[data-stage]"))) {
      expect(r.getAttribute("height")).not.toContain("NaN");
      expect(r.getAttribute("y")).not.toContain("NaN");
    }
  });

  it("degrades below two stages instead of drawing a one-stage 'flow'", () => {
    const { container } = render(<FlowRibbon stages={[{ id: "a", label: "A", value: 3 }]} title="Flow" />);
    expect(screen.getByRole("img", { name: /not enough stages/i })).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });
});
