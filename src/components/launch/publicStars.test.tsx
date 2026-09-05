// @vitest-environment jsdom
//
// The PUBLIC constellation contract. /launch is session-gated + robots-disallowed, so this field is
// the only version of the star map an anonymous visitor can see — which means it must be provably
// (a) data-free, (b) deterministic (SSR and hydration must agree), and (c) small enough to belong on
// a marketing page. These pin all three, plus the "don't fork the math" rule.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { PublicConstellation } from "./PublicConstellation";
import { PUBLIC_STAR_COUNT, PUBLIC_STAR_MAX, publicStarScore, publicStars } from "./publicStars";
import { starLook, starPosition } from "./fleetMapStars";
import { DENSE_FLEET_STARS } from "./fleetMapStars";

describe("publicStars — deterministic, data-free layout", () => {
  it("returns the same field every call (no randomness, no clock)", () => {
    expect(publicStars()).toEqual(publicStars());
    expect(publicStars(20)).toEqual(publicStars(20));
  });

  it("places stars with the LIVE map's phyllotaxis rather than a forked formula", () => {
    const stars = publicStars(12);
    stars.forEach((s, i) => {
      const { cx, cy } = starPosition(i, 12, `ascent-fleet-${i}`);
      expect(s.cx).toBe(cx);
      expect(s.cy).toBe(cy);
    });
  });

  it("derives size/color/opacity from the LIVE map's starLook", () => {
    for (const s of publicStars(12)) {
      const i = Number(s.key.split("-").pop());
      const look = starLook(publicStarScore(i));
      expect({ r: s.r, color: s.color, opacity: s.opacity }).toEqual(look);
    }
  });

  it("keeps every star inside the 120-unit viewBox", () => {
    for (const s of publicStars(PUBLIC_STAR_MAX)) {
      expect(s.cx - s.r).toBeGreaterThanOrEqual(0);
      expect(s.cy - s.r).toBeGreaterThanOrEqual(0);
      expect(s.cx + s.r).toBeLessThanOrEqual(120);
      expect(s.cy + s.r).toBeLessThanOrEqual(120);
    }
  });

  it("mixes in unscanned stars so the sky reads like a real fleet mid-climb", () => {
    const scores = publicStars().map((s) => s.score);
    expect(scores.some((s) => s == null)).toBe(true);
    expect(scores.some((s) => s != null)).toBe(true);
  });

  it("caps the field far below the dashboard's dense-fleet threshold", () => {
    expect(PUBLIC_STAR_COUNT).toBeLessThan(DENSE_FLEET_STARS / 2);
    expect(PUBLIC_STAR_MAX).toBeLessThan(DENSE_FLEET_STARS / 2);
    // A caller asking for more than the ceiling is clamped, not obeyed.
    expect(publicStars(10_000)).toHaveLength(PUBLIC_STAR_MAX);
    expect(publicStars(-5)).toHaveLength(0);
  });
});

describe("PublicConstellation — a zero-data render", () => {
  it("renders the capped star field without fetching anything", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never);
    const { container } = render(<PublicConstellation />);
    const stars = container.querySelectorAll("circle.launch-star");
    expect(stars).toHaveLength(PUBLIC_STAR_COUNT);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("paints identical positions across renders (SSR/hydration agree)", () => {
    const cxs = (c: HTMLElement) =>
      Array.from(c.querySelectorAll("circle.launch-star")).map((n) => n.getAttribute("cx"));
    expect(cxs(render(<PublicConstellation />).container)).toEqual(
      cxs(render(<PublicConstellation />).container),
    );
  });

  it("reuses the reduced-motion-gated .launch-star / .launch-glow classes", () => {
    const { container } = render(<PublicConstellation />);
    // globals.css zeroes both animations under prefers-reduced-motion — reusing the classes inherits
    // that gate instead of declaring a second, ungated one.
    expect(container.querySelectorAll(".launch-star").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".launch-glow")).toHaveLength(1);
  });

  it("exposes one labelled image, not 64 anonymous circles, and no links", () => {
    const { container } = render(<PublicConstellation />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toMatch(/illustrative/i);
    // Nothing interactive: the public field must not imply clickable repo reports.
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("honors an explicit count", () => {
    const { container } = render(<PublicConstellation count={8} />);
    expect(container.querySelectorAll("circle.launch-star")).toHaveLength(8);
  });
});
