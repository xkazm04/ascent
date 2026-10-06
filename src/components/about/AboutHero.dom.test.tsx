// @vitest-environment jsdom
//
// GOLDEN-TRIO: do not lead with ROI. The masthead lede is the first sentence a visitor reads on
// /about; it used to promise "the highest-ROI path". Pin the RENDERED copy to score + ladder +
// evidence (same ingredients as siteDescription()), not a payoff ranking.
//
// Also pins the masthead's structural contracts: the `hero` snap anchor, the stat ledger, and that
// AboutLanding actually composes it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/landing/prototypes/index/ScoreGauge", () => ({
  ScoreGauge: () => <div data-testid="score-gauge" />,
}));

import { AboutHero } from "./AboutHero";

beforeAll(() => {
  if (!("IntersectionObserver" in window)) {
    class IO {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  }
});

describe("AboutHero lede", () => {
  it("names the score, the ladder and the evidence — not a highest-ROI path", () => {
    render(<AboutHero />);
    const lede = screen.getByText(/scattered AI adoption/i);
    expect(lede.textContent).toMatch(/score/i);
    expect(lede.textContent).toMatch(new RegExp(`${LEVELS.length}-level`));
    expect(lede.textContent).toMatch(new RegExp(`${DIMENSIONS.length} dimensions`));
    expect(lede.textContent).toMatch(/ladder/i);
    expect(lede.textContent).toMatch(/evidence/i);
    expect(lede.textContent).not.toMatch(/highest-ROI|highest ROI/i);
  });
});

// Comments stripped so source guards read the code, not the prose around it.
const read = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

describe("AboutHero — the /about masthead", () => {
  it("renders with no props (the backdrop image is optional) and anchors the `hero` snap stop", () => {
    const { container } = render(<AboutHero />);
    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector("section#hero")).not.toBeNull();
  });

  it("stays on-brand: no emoji anywhere in the section copy", () => {
    const { container } = render(<AboutHero />);
    expect(container.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("prints a three-cell stat ledger", () => {
    const { container } = render(<AboutHero />);
    const text = container.textContent ?? "";
    expect(text).toContain("Levels");
    expect(text).toContain("Dimensions");
    expect(text).toContain("0–100");
  });

  // useCountUp renders 0 until the figure scrolls into view, so the count cannot be asserted in the
  // DOM; the derived-constant guard is a source guard (which also survives the ledger moving onto a
  // shared primitive). Typing "5" and "9" into the JSX would make the deck lie about the rubric.
  it("derives the ledger figures from the rubric, never from literals", () => {
    const src = read("src/components/about/AboutHero.tsx");
    expect(src).toMatch(/target=\{LEVELS\.length\}/);
    expect(src).toMatch(/target=\{DIMENSIONS\.length\}/);
  });
});

describe("AboutHero is actually composed onto the /about deck", () => {
  // Source guards: a section nobody renders — or a snap stop the nav never lists — is invisible in
  // production while every render test above still passes.
  const shell = read("src/components/about/AboutLanding.tsx");

  it("AboutLanding renders <AboutHero />", () => {
    expect(shell).toMatch(/<AboutHero\b[^>]*\/>/);
  });

  it("AboutLanding lists the `hero` deck stop", () => {
    expect(shell).toMatch(/id: "hero"/);
  });
});
