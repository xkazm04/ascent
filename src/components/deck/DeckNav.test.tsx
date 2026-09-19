// @vitest-environment jsdom
//
// Below lg, DeckNav used to collapse the section roster to prev/next plus aria-hidden pills, so a
// mid-deck chapter (ROI, CTA, Pricing) was not a jump target. The mobile bar now lists every section
// as an #id anchor inside a native <details> overview.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DeckNav, type DeckSectionRef } from "./DeckNav";

const SECTIONS: DeckSectionRef[] = [
  { id: "hero", label: "Overview" },
  { id: "roi", label: "ROI simulator" },
  { id: "pricing", label: "Plans" },
  { id: "cta", label: "Get started" },
];

function mobileNav(container: HTMLElement): HTMLElement {
  const nav = container.querySelector('nav[aria-label="Section navigation"]');
  if (!(nav instanceof HTMLElement)) throw new Error("mobile DeckNav is missing");
  return nav;
}

describe("DeckNav mobile jump list", () => {
  it("exposes every section as an href=#id jump target in the mobile bar", () => {
    const { container } = render(<DeckNav sections={SECTIONS} />);
    const nav = mobileNav(container);
    for (const s of SECTIONS) {
      expect(nav.querySelector(`a[href="#${s.id}"]`)).not.toBeNull();
    }
    expect(nav.querySelector('a[href="#roi"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#cta"]')).not.toBeNull();
  });

  it("puts those jumps in a native details list that is not aria-hidden", () => {
    const { container } = render(<DeckNav sections={SECTIONS} />);
    const nav = mobileNav(container);
    const details = nav.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.querySelector("summary")).not.toBeNull();
    expect(details!.querySelector('a[href="#roi"]')).not.toBeNull();
    expect(details!.querySelector('a[href="#cta"]')).not.toBeNull();
    expect(details!.closest("[aria-hidden]")).toBeNull();
    expect(nav.querySelector('a[aria-label="Next: ROI simulator"]')).not.toBeNull();
  });
});
