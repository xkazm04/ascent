// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BandLadder, type LadderBand } from "./BandLadder";
import { DECLARED_DASH, HATCH_ID, STATE_LABEL } from "./states";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

const BANDS: LadderBand[] = [
  { id: "open", label: "Agent-authorable", state: "measured", count: 128 },
  { id: "review", label: "Review required", state: "declared", count: 34 },
  { id: "never", label: "Never agent-authored", state: "not-judged", count: 7 },
];

describe("BandLadder accessibility", () => {
  it("names itself from the bands it draws, outermost first", () => {
    render(<BandLadder bands={BANDS} title="Stance perimeter" />);
    const name = screen.getByRole("img", { name: /Stance perimeter/i }).getAttribute("aria-label")!;
    expect(name.indexOf("Agent-authorable")).toBeLessThan(name.indexOf("Never agent-authored"));
    expect(name).toContain("declared, not enforced");
  });

  it("renders an sr-only table with a row per band", () => {
    render(<BandLadder bands={BANDS} title="Stance perimeter" />);
    expect(screen.getByRole("table", { name: /Stance perimeter/i })).toBeInTheDocument();
    for (const b of BANDS) expect(screen.getByRole("rowheader", { name: b.label })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: STATE_LABEL.declared })).toBeInTheDocument();
  });
});

describe("BandLadder encodes the band's state", () => {
  it("a declared band is a dashed outline with no fill; a measured one is filled", () => {
    const { container } = render(<BandLadder bands={BANDS} />);
    const declared = container.querySelector('[data-band="review"]')!;
    expect(declared.getAttribute("fill")).toBe("none");
    expect(declared.getAttribute("stroke-dasharray")).toBe(DECLARED_DASH);

    const measured = container.querySelector('[data-band="open"]')!;
    expect(measured.getAttribute("fill")).not.toBe("none");
    expect(measured.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("a not-judged band hatches and prints NO count — in the picture or in the table", () => {
    const { container } = render(<BandLadder bands={BANDS} />);
    expect(container.querySelector('[data-band="never"]')!.getAttribute("fill")).toBe(`url(#${HATCH_ID})`);
    const svgText = Array.from(container.querySelectorAll("svg text")).map((t) => t.textContent);
    expect(svgText).toContain("128");
    expect(svgText).not.toContain("7");
    // The sr-only row says "not judged" and an em dash — never the number.
    expect(screen.getByRole("cell", { name: STATE_LABEL["not-judged"] })).toBeInTheDocument();
  });

  it("draws the edge that crosses the outer boundary with no declaration behind it", () => {
    const { container } = render(<BandLadder bands={BANDS} edge={{ label: "repos with no stance", count: 12 }} />);
    expect(container.querySelector("[data-edge]")).not.toBeNull();
    expect(screen.getByRole("img", { name: /12 repos with no stance crosses the outer boundary/i })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /crosses the outer boundary/i })).toBeInTheDocument();
  });

  it("degrades to a labelled placeholder with no bands", () => {
    const { container } = render(<BandLadder bands={[]} title="Stance perimeter" />);
    expect(screen.getByRole("img", { name: /no bands declared/i })).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });
});
