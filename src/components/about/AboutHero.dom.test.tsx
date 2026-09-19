// @vitest-environment jsdom
//
// GOLDEN-TRIO: do not lead with ROI. The masthead lede is the first sentence a visitor reads on
// /about; it used to promise "the highest-ROI path". Pin the RENDERED copy to score + ladder +
// evidence (same ingredients as siteDescription()), not a payoff ranking.

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
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
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
