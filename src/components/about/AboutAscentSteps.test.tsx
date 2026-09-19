// @vitest-environment jsdom
//
// ABOUT #2 (mobile legibility): the staircase is a fixed 960-wide SVG scaled to fit, so on a phone its
// labels shrink to ~5px. The fix adds a stacked, full-size list for < sm (the SVG returns at sm+). These
// pin that (a) the same ladder data is present in a legible non-SVG list, and (b) the SVG is the sm+ variant.

import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { AboutAscentSteps } from "./AboutAscentSteps";
import { LEVELS } from "@/lib/maturity/model";

// framer-motion needs matchMedia (useReducedMotion) + IntersectionObserver (whileInView), neither of
// which jsdom implements. Stub both; the IO stub never fires, leaving nodes at their initial (in-DOM) state.
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

describe("AboutAscentSteps mobile stacked variant", () => {
  it("renders every level's id + name in a legible stacked list for < sm", () => {
    const { container } = render(<AboutAscentSteps />);
    const list = container.querySelector("ol");
    expect(list).not.toBeNull();
    // sm:hidden = the list is the mobile-only reflow path.
    expect(list!.className).toMatch(/sm:hidden/);
    // Same ladder data as the SVG — each level's id + name present as real (non-SVG) text.
    for (const l of LEVELS) {
      const items = screen.getAllByText(l.id); // id also appears in the SVG <text>, hence getAllByText
      expect(items.length).toBeGreaterThan(0);
      expect(screen.getAllByText(l.name).length).toBeGreaterThan(0);
    }
  });

  it("keeps the SVG staircase as the sm+ variant (hidden on mobile)", () => {
    const { container } = render(<AboutAscentSteps />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("class") ?? "").toMatch(/hidden/);
    expect(svg!.getAttribute("class") ?? "").toMatch(/sm:block/);
  });
});

// Unlock captions used to be a hand-kept UNLOCK map that paraphrased LEVELS.tagline and had
// already drifted (L5 said "self-governing"). These pin that every rung's caption is the model
// tagline in both the stacked list and the SVG, so a re-word in the model moves the about page.
describe("AboutAscentSteps unlock lines are LEVELS.tagline", () => {
  it("renders every LEVELS[i].tagline in the stacked list and the SVG (5 of 5)", () => {
    const { container } = render(<AboutAscentSteps />);
    expect(LEVELS).toHaveLength(5);
    const listItems = [...container.querySelectorAll("ol li")];
    expect(listItems).toHaveLength(LEVELS.length);
    const svgTexts = [...container.querySelectorAll("svg text")].map((n) => n.textContent);
    for (const [i, l] of LEVELS.entries()) {
      expect(listItems[i]!.textContent, l.id).toContain(l.tagline);
      expect(svgTexts, l.id).toContain(l.tagline);
    }
  });

  it("does not call L5 self-governing: the model tagline is the unlock line", () => {
    const { container } = render(<AboutAscentSteps />);
    expect(container.textContent).not.toMatch(/self-governing/i);
    const l5 = LEVELS.find((l) => l.id === "L5");
    expect(l5?.tagline).toBeTruthy();
    expect(l5!.tagline).not.toMatch(/self-governing/i);
  });
});
