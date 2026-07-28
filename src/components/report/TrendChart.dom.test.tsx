// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendChart, type TrendPoint } from "./TrendChart";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// G5-30. A keyless/mock scan is scored by the deterministic rubric with NO model contribution. Drawn
// as an ordinary solid dot on the same line, it reads as a real jump or drop between the model-scored
// scans on either side. The engine was only ever visible in the hover tooltip — pointer-only, and
// invisible to anyone reading the line's shape.

const at = (d: number) => `2026-07-${String(d).padStart(2, "0")}T09:00:00.000Z`;

function pt(score: number, day: number, engine?: string): TrendPoint {
  return { score, at: at(day), engine };
}

const MIXED: TrendPoint[] = [pt(70, 1, "claude-cli"), pt(30, 2, "mock"), pt(72, 3, "claude-cli")];

/** The plot's own marks — the legend swatch below the chart is also a hollow circle, so scope to
 *  the chart svg rather than the whole container. */
const marks = (container: HTMLElement) =>
  Array.from(container.querySelector('svg[role="img"]')!.querySelectorAll("circle"));

describe("TrendChart mock-vs-model point provenance", () => {
  it("draws a mock point HOLLOW and a model point solid — the caveat rides on the mark, not the hue", () => {
    const { container } = render(<TrendChart points={MIXED} />);
    const mock = marks(container).filter((c) => c.hasAttribute("data-mock"));
    expect(mock).toHaveLength(1);
    // Hollow = surface fill with the SCORE's colour on the stroke, so the red→green value ramp and
    // its CVD-safety are untouched; only the mark's fill changes.
    expect(mock[0]!.getAttribute("fill")).toBe("var(--color-surface-strong)");
    expect(mock[0]!.getAttribute("stroke")).toMatch(/^#[0-9a-f]{6}$/i);
    // The two model-scored points stay solid (score-coloured fill, surface ring).
    const solid = marks(container).filter((c) => !c.hasAttribute("data-mock"));
    expect(solid).toHaveLength(2);
    for (const c of solid) expect(c.getAttribute("fill")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("renders the legend footnote naming the hollow mark and the non-comparability", () => {
    render(<TrendChart points={MIXED} />);
    const note = screen.getByText(/hollow points are demo scans/i);
    expect(note).toBeInTheDocument();
    expect(note.textContent).toMatch(/not comparable/i);
  });

  it("shows the footnote for an ALL-mock series too — shape with no key is not an encoding", () => {
    render(<TrendChart points={[pt(30, 1, "mock"), pt(31, 2, "mock")]} />);
    expect(screen.getByText(/hollow points are demo scans/i)).toBeInTheDocument();
  });

  it("stays silent on a purely model-scored series — no legend where there is nothing to explain", () => {
    const { container } = render(<TrendChart points={[pt(70, 1, "claude-cli"), pt(72, 2, "bedrock")]} />);
    expect(screen.queryByText(/hollow points are demo scans/i)).not.toBeInTheDocument();
    expect(marks(container).filter((c) => c.hasAttribute("data-mock"))).toHaveLength(0);
  });

  it("does NOT flag an engine-less point (an org rollup averages several scans) as a demo scan", () => {
    const { container } = render(<TrendChart points={[pt(70, 1), pt(72, 2)]} />);
    expect(marks(container).filter((c) => c.hasAttribute("data-mock"))).toHaveLength(0);
    expect(screen.queryByText(/hollow points are demo scans/i)).not.toBeInTheDocument();
  });

  it("carries provenance into the screen-reader table, so the caveat is not pointer-only", () => {
    render(<TrendChart points={MIXED} />);
    expect(screen.getByRole("columnheader", { name: /scored by/i })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: /demo scan — deterministic rubric, no model/i })).toBeInTheDocument();
    expect(screen.getAllByRole("cell", { name: "claude-cli" })).toHaveLength(2);
  });

  it("renders an em-dash, not a demo flag, in the provenance cell of an engine-less point", () => {
    render(<TrendChart points={[pt(70, 1), pt(72, 2)]} />);
    expect(screen.getAllByRole("cell", { name: "—" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/demo scan/i)).not.toBeInTheDocument();
  });
});
