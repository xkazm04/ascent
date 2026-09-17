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

  // The picture is data-free PublicConstellation. Notes that say "live as it scans" / "scores stream
  // in" are a lie about the vignette; the Illustrative stamp is the honesty, the notes decode the sky.
  it("keeps the Illustrative stamp and never claims the vignette is live-scanning", () => {
    const { container } = render(<IndexFleet />);
    expect(container.textContent).toMatch(/Illustrative fleet/);
    const notes = Array.from(container.querySelectorAll("dl dt, dl dd"))
      .map((el) => el.textContent ?? "")
      .join("\n");
    expect(notes.length).toBeGreaterThan(0);
    expect(notes).not.toMatch(/\blive\b/i);
    expect(notes).not.toMatch(/stream/i);
    expect(notes).not.toMatch(/refresh/i);
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
    // Props are allowed (the section takes `selfHosted`); what is pinned is that it is rendered.
    expect(src).toMatch(/<IndexFleet\b[^>]*\/>/);
    expect(src).toMatch(/from "\.\/IndexFleet"/);
  });

  it("IndexLanding lists the `fleet` deck stop", () => {
    const src = readFileSync(join(process.cwd(), "src/components/landing/prototypes/IndexLanding.tsx"), "utf8");
    expect(src).toMatch(/id: "fleet"/);
  });

  it("FLEET_NOTES decode the metaphor and do not claim live streaming", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/landing/prototypes/index/IndexFleet.tsx"),
      "utf8",
    );
    const notesBlock = src.match(/const FLEET_NOTES[\s\S]*?\];/)?.[0] ?? "";
    expect(notesBlock.length).toBeGreaterThan(0);
    expect(notesBlock).not.toMatch(/\blive\b/i);
    expect(notesBlock).not.toMatch(/stream/i);
    expect(notesBlock).not.toMatch(/refresh/i);
    expect(src).toMatch(/Illustrative fleet/);
  });
});
