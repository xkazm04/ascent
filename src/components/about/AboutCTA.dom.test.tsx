// @vitest-environment jsdom
//
// The /about deck's closing screen. Three things here are load-bearing and none of them is visible
// in a screenshot:
//   1. `data-deck-last` — globals.css keys the hidden section connector off it. A refactor that
//      drops the attribute breaks the deck's last snap boundary silently.
//   2. the CURATED footer link set — AboutCTA's own comment says this subset is deliberate and must
//      be revisited on purpose, not by drift.
//   3. the conversion pair itself.
// Asserted on the rendered DOM so they survive the section moving onto a shared primitive.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { demoOrgHref } from "@/lib/site";
import { AboutCTA } from "./AboutCTA";

// Strip comments first: AboutLanding's own comments name sections, and a matcher over raw text
// would be satisfied by the prose rather than by the JSX / table entry.
const SHELL = readFileSync(join(process.cwd(), "src/components/about/AboutLanding.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

const hrefsIn = (root: ParentNode, selector: string) =>
  Array.from(root.querySelectorAll(selector)).map((a) => a.getAttribute("href"));

describe("AboutCTA — the /about closing section", () => {
  it("is a deck section with the `cta` snap anchor the nav targets", () => {
    const { container } = render(<AboutCTA />);
    expect(container.querySelector("section#cta")).not.toBeNull();
    expect(container.querySelector("h2")).not.toBeNull();
  });

  it("carries `data-deck-last` — globals.css hides the section connector off this attribute", () => {
    const { container } = render(<AboutCTA />);
    expect(container.querySelector("section#cta")).toHaveAttribute("data-deck-last");
  });

  it("stays on-brand: no emoji anywhere in the section copy", () => {
    const { container } = render(<AboutCTA />);
    expect(container.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("keeps the CURATED footer nav, not the full site set", () => {
    const { container } = render(<AboutCTA />);
    const hrefs = hrefsIn(container, "footer a");
    expect(hrefs).toEqual(["/pricing", "/onboarding", "/about-org", "/"]);
    // The dilution guard: Leaderboard/Usage belong to the canonical FOOTER_LINKS set and are kept
    // OFF this screen on purpose (they would compete with the conversion moment).
    expect(hrefs).not.toContain("/leaderboard");
    expect(hrefs).not.toContain("/usage");
  });

  it("carries the conversion pair above the footer (this section exists to convert)", () => {
    const { container } = render(<AboutCTA />);
    // Scoped to anchors OUTSIDE the footer: the footer also links /onboarding, so an unscoped
    // check would pass with the buttons deleted.
    const buttons = Array.from(container.querySelectorAll("a")).filter((a) => !a.closest("footer"));
    expect(buttons.map((a) => a.getAttribute("href"))).toEqual(["/onboarding", demoOrgHref()]);
  });
});

describe("AboutCTA is actually composed onto the /about deck", () => {
  // Source guards: a section nobody renders — or a snap stop the nav never lists — is invisible in
  // production while every render test above still passes.
  it("AboutLanding renders <AboutCTA />", () => {
    expect(SHELL).toMatch(/<AboutCTA\b[^>]*\/>/);
  });

  it("AboutLanding lists the `cta` deck stop", () => {
    expect(SHELL).toMatch(/id: "cta"/);
  });
});
