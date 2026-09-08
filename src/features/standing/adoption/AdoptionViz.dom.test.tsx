// @vitest-environment jsdom
//
// The redesign's accessibility + encoding contract for the Adoption tab (docs/ORG-UX-REDESIGN.md
// §2.4/§2.6): every graphic carries role="img" with a generated <title>, dense charts carry an
// sr-only table built from the SAME numbers, and the two absences the tab used to render identically
// now paint differently.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { AdoptionOverview } from "@/lib/org/adoption";
import { AdoptionCurve } from "./AdoptionCurve";
import { buildAdoptionCurve } from "./adoptionCurveModel";
import { TeamAdoption } from "./TeamAdoption";
import { ChampionsCard } from "./ChampionsCard";

type Team = AdoptionOverview["teams"][number];
const team = (over: Partial<Team> = {}): Team => ({
  slug: "@acme/core",
  name: "core",
  aiCommitShare: 40,
  contributors: 5,
  aiContributors: 2,
  repoCount: 3,
  ...over,
});

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

  it("degrades to a labelled placeholder rather than plotting a NaN geometry", () => {
    const { container } = render(<AdoptionCurve model={buildAdoptionCurve({ high: 0, some: 0, none: 0 }, 0)} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByRole("img", { name: /no contributor population/i })).toBeTruthy();
  });
});

describe("TeamAdoption — the void-vs-zero split, on screen", () => {
  it("hatches an unattributed team and prints NO numeral on it", () => {
    const { container } = render(
      <TeamAdoption
        slug="acme"
        pairing={null}
        teams={[team({ aiCommitShare: 40 }), team({ slug: "@acme/ops", name: "ops", contributors: 0, aiContributors: 0, aiCommitShare: 0 })]}
      />,
    );
    const measured = container.querySelector('[data-cell="@acme/core:AI commits"]')!;
    const unjudged = container.querySelector('[data-cell="@acme/ops:AI commits"]')!;
    expect(measured.getAttribute("data-state")).toBe("measured");
    expect(unjudged.getAttribute("data-state")).toBe("not-judged");
    expect(measured.querySelector("[data-score]")).toBeTruthy();
    expect(unjudged.querySelector("[data-score]")).toBeNull();
    expect(container.textContent).toContain("1 team carry no contributor attribution");
  });

  it("keeps a measured 0% scored — a reading is not an absence", () => {
    const { container } = render(
      <TeamAdoption slug="acme" pairing={null} teams={[team({ aiCommitShare: 0, aiContributors: 0, contributors: 12 })]} />,
    );
    const cell = container.querySelector('[data-cell="@acme/core:AI commits"]')!;
    expect(cell.getAttribute("data-state")).toBe("measured");
    expect(cell.querySelector("[data-score]")?.textContent).toBe("0");
    expect(container.textContent).not.toContain("carry no contributor attribution");
  });

  it("leads the no-CODEOWNERS empty state with the void mark", () => {
    render(<TeamAdoption slug="acme" pairing={null} teams={[]} />);
    expect(screen.getByRole("img", { name: /No measurement/ })).toBeTruthy();
    expect(screen.getByText(/Add CODEOWNERS files/)).toBeTruthy();
  });
});

describe("ChampionsCard — a suppression is not a zero", () => {
  it("encodes the naming-floor suppression as not-judged", () => {
    render(<ChampionsCard slug="acme" champions={[]} totalContributors={1} />);
    expect(screen.getByRole("img", { name: /Not judged/ })).toBeTruthy();
    expect(screen.getByText(/Withheld/)).toBeTruthy();
  });

  it("encodes a real 'nobody uses AI yet' as the missing void, a different mark", () => {
    render(<ChampionsCard slug="acme" champions={[]} totalContributors={40} />);
    expect(screen.getByRole("img", { name: /No measurement/ })).toBeTruthy();
    expect(screen.getByText(/No AI-attributed contributors yet/)).toBeTruthy();
  });
});
