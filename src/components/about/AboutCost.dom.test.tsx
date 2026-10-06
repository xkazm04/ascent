// @vitest-environment jsdom
//
// The /about deck's problem statement. It takes no props and no data, so what can break it is a
// composition slip (nobody renders it) or a card silently dropping out of the grid.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AboutCost } from "./AboutCost";

// Comments stripped so the guards below read the JSX / table entry, not the prose around it.
const SHELL = readFileSync(join(process.cwd(), "src/components/about/AboutLanding.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

describe("AboutCost — the /about problem statement", () => {
  it("is a deck section with the `cost` snap anchor the nav targets", () => {
    const { container } = render(<AboutCost />);
    expect(container.querySelector("section#cost")).not.toBeNull();
  });

  it("stays on-brand: no emoji anywhere in the section copy", () => {
    const { container } = render(<AboutCost />);
    expect(container.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("prints all four costs — the section IS the list, so a dropped card is a silent content loss", () => {
    const { container } = render(<AboutCost />);
    const text = container.textContent ?? "";
    for (const term of ["Rework", "Failed audits", "Slow onboarding", "Silent regressions"]) {
      expect(text).toContain(term);
    }
  });
});

describe("AboutCost is actually composed onto the /about deck", () => {
  // Source guards: a section nobody renders — or a snap stop the nav never lists — is invisible in
  // production while every render test above still passes.
  it("AboutLanding renders <AboutCost />", () => {
    expect(SHELL).toMatch(/<AboutCost\b[^>]*\/>/);
  });

  it("AboutLanding lists the `cost` deck stop", () => {
    expect(SHELL).toMatch(/id: "cost"/);
  });
});
