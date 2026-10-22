// @vitest-environment jsdom
//
// The redesign's accessibility + encoding contract for the Adoption tab (docs/ORG-UX-REDESIGN.md
// §2.4/§2.6): every graphic carries role="img" with a generated <title>, dense charts carry an
// sr-only table built from the SAME numbers, and the two absences the tab used to render identically
// now paint differently.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AdoptionCurve } from "./AdoptionCurve";
import { buildAdoptionCurve } from "./adoptionCurveModel";

describe("AdoptionCurve", () => {
  it("draws the three measured marks and the unobserved envelope between them", () => {
    const { container } = render(<AdoptionCurve model={buildAdoptionCurve({ high: 6, some: 12, none: 22 }, 40, 32)} />);
    expect(container.querySelectorAll("[data-mark]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-gap]").length).toBeGreaterThan(0);
    expect(container.querySelector("[data-org-share]")).toBeTruthy();
  });

  it("carries role=img with a generated title stating the population", () => {
    render(<AdoptionCurve model={buildAdoptionCurve({ high: 6, some: 12, none: 22 }, 40)} />);
    const img = screen.getByRole("img", { name: /Adoption curve across 40 contributors/ });
    expect(within(img).getByText(/bounded but not measured/)).toBeTruthy();
  });

  it("ships an sr-only table built from the same numbers as the geometry", () => {
    const { container } = render(<AdoptionCurve model={buildAdoptionCurve({ high: 6, some: 12, none: 22 }, 40)} />);
    const table = container.querySelector("table.sr-only")!;
    expect(table).toBeTruthy();
    expect(within(table as HTMLElement).getByRole("rowheader", { name: "≥50% AI" })).toBeTruthy();
    expect((table.textContent ?? "").replace(/\s+/g, " ")).toContain("18");
  });

  it("sets every glyph in HTML — the plot SVG draws marks only, in percent, with no viewBox", () => {
    const { container } = render(<AdoptionCurve model={buildAdoptionCurve({ high: 6, some: 12, none: 22 }, 40, 32)} />);
    expect(container.querySelectorAll("svg text")).toHaveLength(0);
    expect(container.querySelector("svg[viewBox]")).toBeNull();
    const labels = Array.from(container.querySelectorAll("[data-mark-label]")).map((n) => n.textContent);
    expect(labels).toEqual(["any40", "≥1% AI18", "≥50% AI6"]);
    expect(container.querySelector('[data-mark="50"] circle')!.getAttribute("cx")).toBe("50%");
  });

  it("keeps the sr-only table outside the role=img element", () => {
    render(<AdoptionCurve model={buildAdoptionCurve({ high: 6, some: 12, none: 22 }, 40)} />);
    expect(screen.getByRole("img", { name: /Adoption curve/ }).querySelector("table")).toBeNull();
  });

  it("degrades to a labelled placeholder rather than plotting a NaN geometry", () => {
    const { container } = render(<AdoptionCurve model={buildAdoptionCurve({ high: 0, some: 0, none: 0 }, 0)} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("img", { name: /no contributor population/i })).toBeTruthy();
  });
});
