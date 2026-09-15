// @vitest-environment jsdom
//
// The canvas-graph scene under jsdom: every declared technique has a `[data-technique]` region; the
// reduced path renders the same regions; the fiction notice shows; every SURFACE_VOLUMES value mounts
// (culling renders a window, never the world); the keyboard cursor lands and announces; a wheel zooms
// to the pointer; a nudge is one transaction; a node press below the threshold is a click, not a move.

import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord } from "@/lib/org/surface-catalog";
import { regionSlugs } from "../surfaceSpotlight";
import { body } from "./index";

const { Scene, techniques } = body;
const mount = (reduced: boolean, volume: (typeof SURFACE_VOLUMES)[number] = SURFACE_VOLUMES[0]) => render(<Scene technique={null} reduced={reduced} volume={volume} />);
const canvas = (c: HTMLElement) => c.querySelector("[data-canvas]") as SVGSVGElement;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
};

describe("canvas-graph scene", () => {
  it("declares every technique of its catalog record as a region, once", () => {
    const { container } = mount(false);
    const record = surfaceRecord("canvas-graph");
    expect(record).toBeTruthy();
    const regions = regionSlugs(container);
    for (const t of techniques) expect(regions.filter((r) => r === t.slug), `region for ${t.slug}`).toHaveLength(1);
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
  });

  it("renders the reduced path with the same regions and says its data is fiction", () => {
    const { container } = mount(true);
    expect(container.querySelector("[data-scene]")?.getAttribute("data-reduced")).toBe("true");
    expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
    expect(screen.getByText(/fixture data/i)).toBeTruthy();
  });

  it("mounts at every volume, rendering a culled window rather than the world", async () => {
    for (const volume of SURFACE_VOLUMES) {
      const { container, unmount } = mount(false, volume);
      await flush();
      const inView = Number(container.querySelector("[data-nodes-in-view]")?.getAttribute("data-nodes-in-view"));
      expect(inView).toBeGreaterThan(0);
      expect(inView).toBeLessThan(400);
      expect(container.querySelectorAll("[data-node-id]:not([data-port])").length).toBeLessThanOrEqual(inView);
      expect(container.querySelector("[data-measured]")?.getAttribute("data-measured")).toBe("true");
      unmount();
    }
  });

  it("carries prose and a real source excerpt for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length).toBeGreaterThan(40);
    }
  });

  it("keyboard: the cursor lands on a node, is announced in graph terms, and Enter selects", async () => {
    const { container } = mount(true);
    await flush();
    const svg = canvas(container);
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    const announcer = container.querySelector("[data-announcer]") as HTMLElement;
    expect(announcer.textContent).toMatch(/— (app|service|lib) — \d+ inputs?, \d+ outputs?/);
    expect(svg.getAttribute("aria-activedescendant")).toMatch(/^cg-node-/);
    expect(container.querySelector("[data-cursor]")).toBeTruthy();
    expect(container.querySelector("[data-selected]")).toBeNull(); // focus is not selection
    fireEvent.keyDown(svg, { key: "Enter" });
    expect(container.querySelector("[data-selected]")).toBeTruthy();
    // A nudge is exactly one transaction.
    fireEvent.keyDown(svg, { key: "ArrowRight", shiftKey: true });
    expect(container.querySelector("[data-history-count]")?.getAttribute("data-history-count")).toBe("1");
    expect(container.querySelector("[data-user-placed]")?.getAttribute("data-user-placed")).toBe("1");
  });

  it("zoom buttons route through the authority: + raises z, 0 fits the world (a cut under reduced)", async () => {
    const { container } = mount(true);
    await flush();
    const before = Number(container.querySelector("[data-cam-z]")?.getAttribute("data-cam-z"));
    fireEvent.click(screen.getByLabelText("Zoom in"));
    await flush();
    const after = Number(container.querySelector("[data-cam-z]")?.getAttribute("data-cam-z"));
    expect(after).toBeCloseTo(before * 1.25, 2);
    fireEvent.keyDown(canvas(container), { key: "0" });
    await flush();
    expect(Number(container.querySelector("[data-commits]")?.getAttribute("data-commits"))).toBeGreaterThanOrEqual(2);
  });

  it("a node press below the threshold is a click (selects), never a move", async () => {
    const { container } = mount(false);
    await flush();
    const node = container.querySelector("[data-node-id]:not([data-port])") as SVGGElement;
    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(node, { clientX: 101, clientY: 101, pointerId: 1 });
    fireEvent.pointerUp(node, { clientX: 101, clientY: 101, pointerId: 1 });
    expect(container.querySelector("[data-selected]")).toBeTruthy();
    expect(container.querySelector("[data-history-count]")?.getAttribute("data-history-count")).toBe("0");
    // Past the threshold it is a drag: one `move` transaction, position now user-authored.
    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(node, { clientX: 140, clientY: 120, pointerId: 1 });
    expect(container.querySelector("[data-drag-phase]")?.getAttribute("data-drag-phase")).toBe("drag");
    fireEvent.pointerUp(node, { clientX: 140, clientY: 120, pointerId: 1 });
    expect(container.querySelector("[data-history-count]")?.getAttribute("data-history-count")).toBe("1");
    expect(container.querySelector("[data-user-placed]")?.getAttribute("data-user-placed")).toBe("1");
  });

  it("edge economy: dropping a kind removes its ink; the reset doorway is confirmed", async () => {
    const { container } = mount(false);
    await flush();
    const edgeRegion = container.querySelector('[data-technique="edge-management"]') as HTMLElement;
    const drawn = () => Number(container.querySelector("[data-edges-drawn]")?.getAttribute("data-edges-drawn"));
    const before = drawn();
    fireEvent.click(within(edgeRegion).getByText("import"));
    expect(drawn()).toBeLessThan(before);
    const layoutRegion = container.querySelector('[data-technique="graph-layout"]') as HTMLElement;
    expect(within(layoutRegion).getByText("reset layout…")).toBeDisabled(); // nothing user-placed yet
    fireEvent.click(within(layoutRegion).getByText("re-layout (generated only)"));
    expect(container.querySelector("[data-layout-run]")?.getAttribute("data-layout-run")).toBe("1");
  });
});
