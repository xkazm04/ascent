// @vitest-environment jsdom
//
// The data-viz scene under jsdom: it mounts inside the frame's MotionScope; every technique the body
// declares has a `[data-technique]` region; the reduced path renders the same regions; every
// SURFACE_VOLUMES value renders without throwing; the fiction line shows; the metric surfaces agree
// to the digit; the sample-floor policy widens the flat series; a poisoned slot fails alone; an
// empty state draws no chrome.

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, within } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord } from "@/lib/org/surface-catalog";
import { applySpotlight, regionSlugs } from "../surfaceSpotlight";
import { MotionScope } from "../surfaceMotionScope";
import { body } from "./index";

const { Scene, techniques } = body;
const mount = (reduced: boolean, volume: (typeof SURFACE_VOLUMES)[number] = SURFACE_VOLUMES[0], technique: string | null = null) =>
  render(
    <MotionScope reduced={reduced}>
      <Scene technique={technique} reduced={reduced} volume={volume} />
    </MotionScope>,
  );
const region = (c: HTMLElement, slug: string) => c.querySelector(`[data-technique="${slug}"]`) as HTMLElement;

describe("data-viz scene", () => {
  it("declares every technique of its catalog record as exactly one region", () => {
    const { container } = mount(false);
    const record = surfaceRecord("data-viz");
    expect(record).toBeTruthy();
    for (const t of techniques) expect(container.querySelectorAll(`[data-technique="${t.slug}"]`), t.slug).toHaveLength(1);
    expect(new Set(regionSlugs(container)).size).toBe(techniques.length);
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
  });

  it("renders the reduced path with the same regions, spotlit by the frame's helper", () => {
    const { container } = mount(true, SURFACE_VOLUMES[0], "scale-and-axis-design");
    expect(container.querySelector("[data-scene]")?.getAttribute("data-reduced")).toBe("true");
    expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
    applySpotlight(container, "scale-and-axis-design");
    expect(region(container, "scale-and-axis-design").getAttribute("data-spotlit")).toBe("true");
    expect(region(container, "metric-identity").classList.contains("opacity-40")).toBe(true);
  });

  it("renders at every fixture volume, says its data is fiction, and mounts only the window", () => {
    for (const v of SURFACE_VOLUMES) {
      const { container, unmount } = mount(false, v);
      expect(container.textContent).toMatch(/Fixture data/);
      expect(container.textContent).toContain(v.toLocaleString());
      expect(container.querySelectorAll("[data-row]")).toHaveLength(8);
      unmount();
    }
  });

  it("metric-identity: tile, cell and tooltip agree to the digit, and the 14d variant has no delta", () => {
    const { container } = mount(false);
    const r = region(container, "metric-identity");
    const read = (sel: string) => r.querySelector(sel)?.textContent?.trim();
    expect(read("[data-metric-tile]")).toBe(read("[data-metric-cell]"));
    expect(read("[data-metric-tip]")?.startsWith(read("[data-metric-cell]") ?? "x")).toBe(true);
    fireEvent.click(within(r).getByText("14d"));
    expect(r.textContent).toContain("no previous window — no delta");
    fireEvent.click(within(r).getByText("failed · 7d"));
    expect(r.textContent).toContain("lower-better");
  });

  it("scale-and-axis-design: the sample floor makes the steady series fill its box", () => {
    const { container } = mount(false);
    const r = region(container, "scale-and-axis-design");
    const span = () => Number(r.querySelector("[data-flat-span]")?.getAttribute("data-flat-span"));
    expect(span()).toBe(100);
    fireEvent.click(within(r).getByText("sample floor (defect)"));
    expect(r.getAttribute("data-scale-policy") ?? r.querySelector("[data-scale-policy]")?.getAttribute("data-scale-policy")).toBe("sample-floor");
    expect(span()).toBeLessThan(15);
  });

  it("chart-loading-economics: slots reserve height cold, the engine loads once, one poisoned slot fails alone", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = mount(false);
      const r = region(container, "chart-loading-economics");
      expect(r.querySelectorAll('[data-slot-state="reserved"]')).toHaveLength(3);
      fireEvent.click(within(r).getByText(/open the dashboard/));
      expect(r.querySelectorAll('[data-slot-state="placeholder"]')).toHaveLength(3);
      act(() => vi.advanceTimersByTime(1000));
      expect(r.querySelectorAll('[data-slot-state="drawn"]')).toHaveLength(3);
      fireEvent.click(within(r).getByText("poison series B"));
      expect(r.querySelectorAll('[data-slot-state="failed"]')).toHaveLength(1);
      expect(r.querySelectorAll('[data-slot-state="drawn"]')).toHaveLength(2);
      expect(r.querySelector("[data-reports]")?.getAttribute("data-reports")).toBe("1");
      fireEvent.click(within(r).getByText("retry B"));
      expect(r.querySelectorAll('[data-slot-state="drawn"]')).toHaveLength(3);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("micro-visualizations: a two-point row draws no line, and the column shares one domain", () => {
    const { container } = mount(false);
    const r = region(container, "micro-visualizations");
    const fresh = r.querySelector('[data-shape="new"]') as HTMLElement;
    expect(fresh.querySelector('[data-cell="collecting"]')).toBeTruthy();
    expect(fresh.querySelector("svg")).toBeNull();
    expect(r.querySelectorAll('[data-cell="line"] svg').length).toBeGreaterThan(4);
  });

  it("encoding-vocabulary: a re-sort keeps every series' colour", () => {
    const { container } = mount(false);
    const r = region(container, "encoding-vocabulary");
    const colours = () => new Map(Array.from(r.querySelectorAll("[data-legend]")).map((li) => [li.getAttribute("data-legend"), li.getAttribute("data-color")]));
    const before = colours();
    fireEvent.click(within(r).getByText(/re-sort by score/));
    expect(colours()).toEqual(before);
  });

  it("empty-and-degraded-chart-states: an empty draws no chrome, a gap breaks the line", () => {
    const { container } = mount(false);
    const r = region(container, "empty-and-degraded-chart-states");
    expect(r.querySelector('[data-chrome="drawn"]')).toBeTruthy();
    fireEvent.click(within(r).getByText("not being measured"));
    expect(r.querySelector('[data-chrome="none"]')).toBeTruthy();
    expect(r.querySelector("svg line")).toBeNull();
    fireEvent.click(within(r).getByText("gap inside"));
    expect(r.querySelectorAll("[data-gap]").length).toBeGreaterThan(0);
    expect(r.querySelectorAll("path").length).toBeGreaterThan(1);
  });

  it("carries a real source excerpt and prose for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length).toBeGreaterThan(40);
    }
  });
});
