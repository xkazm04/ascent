// @vitest-environment jsdom
//
// The design-tokens scene under jsdom: the contract half. It mounts inside the frame's MotionScope;
// every technique the body declares has exactly one `[data-technique]` region and matches the catalog
// record; the reduced path renders every region with the ladder rebound at the root; every fixture
// volume renders; the fiction notice shows. Behaviour per region is in Scene.gates.dom.test.tsx.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord, type SurfaceVolume } from "@/lib/org/surface-catalog";
import { applySpotlight, regionSlugs } from "../surfaceSpotlight";
import { MotionScope } from "../surfaceMotionScope";
import { body } from "./index";

const { Scene, techniques } = body;
const mount = (reduced: boolean, volume: SurfaceVolume = SURFACE_VOLUMES[0], technique: string | null = null) =>
  render(
    <MotionScope reduced={reduced}>
      <Scene technique={technique} reduced={reduced} volume={volume} />
    </MotionScope>,
  );

describe("design-tokens scene", () => {
  it("declares every technique of its catalog record as exactly one region", () => {
    const { container } = mount(false);
    const record = surfaceRecord("design-tokens");
    expect(record).toBeTruthy();
    for (const t of techniques) expect(container.querySelectorAll(`[data-technique="${t.slug}"]`), t.slug).toHaveLength(1);
    expect(regionSlugs(container).sort()).toEqual(techniques.map((t) => t.slug).sort());
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
  });

  it("is spotlit by the frame's helper: the selected region ringed, the rest dimmed", () => {
    const { container } = mount(false, SURFACE_VOLUMES[0], "motion-tokens");
    applySpotlight(container, "motion-tokens");
    expect(container.querySelector('[data-technique="motion-tokens"]')?.getAttribute("data-spotlit")).toBe("true");
    expect(container.querySelector('[data-technique="token-taxonomy"]')?.classList.contains("opacity-40")).toBe(true);
  });

  it("renders the reduced path with every region and the ladder rebound at the root", () => {
    const { container } = mount(true);
    const root = container.querySelector("[data-scene]") as HTMLElement;
    expect(root.getAttribute("data-reduced")).toBe("true");
    expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
    expect(root.style.getPropertyValue("--sx-duration-base")).toBe("1ms");
    expect(root.style.getPropertyValue("--sx-duration-instant")).toBe("60ms");
    expect(container.querySelector('[data-step="slow"]')?.getAttribute("data-step-ms")).toBe("1");
    expect(root.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("carries the full ladder when motion is on", () => {
    const { container } = mount(false);
    const root = container.querySelector("[data-scene]") as HTMLElement;
    expect(root.style.getPropertyValue("--sx-duration-base")).toBe("240ms");
    expect(root.style.getPropertyValue("--sx-surface")).toBe("#0f172a");
  });

  it("renders at every fixture volume without throwing", () => {
    for (const v of SURFACE_VOLUMES) {
      const { container, unmount } = mount(false, v);
      expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
      expect(container.querySelector("[data-open]")).toBeTruthy();
      unmount();
    }
  });

  it("says its data is fiction", () => {
    mount(false, SURFACE_VOLUMES[1]);
    expect(screen.getByText(/fixture data/i)).toBeTruthy();
    expect(screen.getByText(/nothing here is an ascent org/i)).toBeTruthy();
  });

  it("carries prose, a real source excerpt and an honest inAscent for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length).toBeGreaterThan(40);
      if (t.inAscent) expect(t.inAscent.file).toMatch(/^src\//);
    }
  });
});
