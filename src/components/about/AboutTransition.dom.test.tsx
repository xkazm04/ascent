// @vitest-environment jsdom
//
// The ladder section, RENDERED. AboutTransition.test.ts already pins the `${LEVELS.length}-level
// ladder` intro by source (and the retired-copy matcher); this file is its complement: what a
// visitor's DOM actually carries once the template literal has been evaluated, plus the deck wiring.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { LEVELS } from "@/lib/maturity/model";
import { AboutTransition } from "./AboutTransition";

// Comments stripped so the guards below read the JSX / table entry, not the prose around it.
const SHELL = readFileSync(join(process.cwd(), "src/components/about/AboutLanding.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

// The staircase's `whileInView` nodes need IntersectionObserver, which jsdom lacks (vitest.setup.dom.js
// supplies matchMedia but not this). The stub never fires, leaving nodes in their in-DOM initial state.
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

describe("AboutTransition — the ladder section, rendered", () => {
  it("is a deck section with the `transition` snap anchor the nav targets", () => {
    const { container } = render(<AboutTransition />);
    expect(container.querySelector("section#transition")).not.toBeNull();
  });

  it("stays on-brand: no emoji anywhere in the section copy", () => {
    const { container } = render(<AboutTransition />);
    expect(container.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("prints the rung count from LEVELS in the rendered intro, never as a typed word", () => {
    const { container } = render(<AboutTransition />);
    expect(container.textContent ?? "").toContain(`${LEVELS.length}-level ladder`);
  });
});

describe("AboutTransition is actually composed onto the /about deck", () => {
  it("AboutLanding renders <AboutTransition />", () => {
    expect(SHELL).toMatch(/<AboutTransition\b[^>]*\/>/);
  });

  it("AboutLanding lists the `transition` deck stop", () => {
    expect(SHELL).toMatch(/id: "transition"/);
  });
});
