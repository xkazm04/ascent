// @vitest-environment jsdom
//
// The landing fleet section is the PUBLIC home of the /launch constellation, so its whole value is
// that it renders for an anonymous visitor with no data and no requests. These pin that, plus the
// composition line that actually puts it on the page (a section component nobody renders is the
// exact failure mode this direction exists to fix) and its deck-nav stop.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { IndexFleet } from "./IndexFleet";
import { PUBLIC_STAR_COUNT } from "@/components/launch/publicStars";

describe("IndexFleet — the public constellation section", () => {
  it("renders the data-free star field with no fetch and no props", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never);
    const { container } = render(<IndexFleet />);
    expect(container.querySelectorAll("circle.launch-star")).toHaveLength(PUBLIC_STAR_COUNT);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("is a deck section with the `fleet` snap anchor the nav targets", () => {
    const { container } = render(<IndexFleet />);
    expect(container.querySelector("section#fleet")).not.toBeNull();
  });

  it("stays on-brand: no emoji anywhere in the section copy", () => {
    const { container } = render(<IndexFleet />);
    expect(container.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("carries an acquisition CTA (this section exists to convert, not just to decorate)", () => {
    const { container } = render(<IndexFleet />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/onboarding");
  });
});

describe("IndexFleet is actually composed onto the landing page", () => {
  // Source guards: a section component nobody renders — or a snap stop the deck nav never lists —
  // is invisible in production while every render test above still passes.
  it("IndexVariant renders <IndexFleet />", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/landing/prototypes/index/IndexVariant.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<IndexFleet\s*\/>/);
    expect(src).toMatch(/from "\.\/IndexFleet"/);
  });

  it("IndexLanding lists the `fleet` deck stop", () => {
    const src = readFileSync(join(process.cwd(), "src/components/landing/prototypes/IndexLanding.tsx"), "utf8");
    expect(src).toMatch(/id: "fleet"/);
  });
});
