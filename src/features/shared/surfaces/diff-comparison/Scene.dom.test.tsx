// @vitest-environment jsdom
//
// The diff-comparison scene under jsdom: it mounts inside the frame's MotionScope; every technique the
// body declares has exactly one `[data-technique]` region; the reduced path renders the same regions;
// every volume renders (and the budget ladder discloses its rung); the fiction line shows; the
// frame's spotlight helper works on it. Mechanism cases live in Scene.mechanisms.test.tsx.

import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord } from "@/lib/org/surface-catalog";
import { applySpotlight, regionSlugs } from "../surfaceSpotlight";
import { MotionScope } from "../surfaceMotionScope";
import { body } from "./index";

const { Scene, techniques } = body;
const mount = (reduced: boolean, volume: (typeof SURFACE_VOLUMES)[number] = SURFACE_VOLUMES[0]) =>
  render(
    <MotionScope reduced={reduced}>
      <Scene technique={null} reduced={reduced} volume={volume} />
    </MotionScope>,
  );
const region = (c: HTMLElement, slug: string) => c.querySelector(`[data-technique="${slug}"]`) as HTMLElement;

describe("diff-comparison scene", () => {
  it("declares every technique of its catalog record as a region, once", () => {
    const { container } = mount(false);
    const record = surfaceRecord("diff-comparison");
    expect(record).toBeTruthy();
    const regions = regionSlugs(container);
    for (const t of techniques) expect(regions.filter((s) => s === t.slug), `region for ${t.slug}`).toHaveLength(1);
    expect(regions).toHaveLength(techniques.length);
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
    expect(screen.getByText(/fixture data/i)).toBeTruthy();
  });

  it("renders at every volume, and the budget picks a disclosed rung instead of mounting the volume", async () => {
    const rungs: string[] = [];
    for (const v of SURFACE_VOLUMES) {
      const { container, unmount } = mount(false, v);
      expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
      // Scheduled computations settle within the declared delay ceiling (≤ 600ms).
      await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
      expect(container.querySelector("[data-diff-state]")?.getAttribute("data-diff-state")).toBe("ready");
      expect(container.querySelectorAll("[data-row]").length).toBeLessThanOrEqual(24 + 7); // window + invisible rows
      const rung = region(container, "computation-offload").textContent ?? "";
      rungs.push(rung.includes("summary counts only") ? "summary" : rung.includes("output capped") ? "capped" : "full");
      unmount();
    }
    expect(rungs).toEqual(["full", "capped", "summary"]);
  });

  it("renders the reduced path with the same regions and no blank canvas", () => {
    const { container } = mount(true);
    expect(container.querySelector("[data-scene]")?.getAttribute("data-reduced")).toBe("true");
    expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
    for (const t of techniques) expect((region(container, t.slug).textContent ?? "").trim().length, t.slug).toBeGreaterThan(40);
    // The small volume takes the synchronous fast path, so the diff is ready on the first commit.
    expect(container.querySelector("[data-diff-state]")?.getAttribute("data-diff-state")).toBe("ready");
  });

  it("is spotlit by the frame's helper: the selected region ringed, the rest dimmed", () => {
    const { container } = mount(false);
    applySpotlight(container, "diff-honesty");
    expect(region(container, "diff-honesty").getAttribute("data-spotlit")).toBe("true");
    expect(region(container, "diff-honesty").classList.contains("ring-accent")).toBe(true);
    expect(region(container, "presentation-modes").classList.contains("opacity-40")).toBe(true);
    applySpotlight(container, null);
    expect(region(container, "presentation-modes").classList.contains("opacity-40")).toBe(false);
  });

  it("carries a real source excerpt and prose for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length, t.slug).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length, t.slug).toBeGreaterThan(40);
      if (t.inAscent) expect(t.inAscent.file).toMatch(/^src\//);
    }
  });
});
