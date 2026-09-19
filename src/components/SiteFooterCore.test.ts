// The header's marketing nav is `hidden ... sm:inline` (StaticNav.MarketingNavLinks) and there is no
// menu behind it, so below 640px the entire nav disappears from every page. The footer is then the
// only persistent chrome that can reach those destinations — and it carried just one of the four.
//
// This pins the coupling rather than the list: adding a marketing nav item now fails here until the
// footer can reach it too, which is the invariant a hand-kept second list cannot hold. (The reverse
// is deliberately NOT asserted — the footer legitimately carries more, e.g. the legal pages.)
import { describe, it, expect } from "vitest";
import { MARKETING_NAV } from "./StaticNav";
import { FOOTER_ATTRIBUTION, FOOTER_LINKS } from "./SiteFooterCore";

describe("the footer can reach every marketing destination the header hides on mobile", () => {
  const footerHrefs = new Set(FOOTER_LINKS.map((l) => l.href));

  it("every MARKETING_NAV href appears in FOOTER_LINKS", () => {
    const unreachable = MARKETING_NAV.filter((item) => !footerHrefs.has(item.href)).map((i) => i.href);
    expect(unreachable).toEqual([]);
  });

  it("the legal pages every public surface must link are present", () => {
    expect(footerHrefs.has("/privacy")).toBe(true);
    expect(footerHrefs.has("/terms")).toBe(true);
  });

  it("no href is listed twice (the map key is the href)", () => {
    expect(footerHrefs.size).toBe(FOOTER_LINKS.length);
  });

  it("the attribution line is non-empty (it must not drop off public pages)", () => {
    expect(FOOTER_ATTRIBUTION.trim().length).toBeGreaterThan(0);
  });
});
