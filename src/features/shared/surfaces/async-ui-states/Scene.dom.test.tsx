// @vitest-environment jsdom
//
// The async-ui-states scene under jsdom: it mounts, every declared technique has exactly one
// `[data-technique]` region, the reduced path renders the same regions, every fixture volume renders,
// the fiction line shows, and the drawer entries are complete. The behavioural half — the empty flash,
// latest-wins, the double-press guard, the failed-refresh degrade — is Scene.behaviour.test.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord } from "@/lib/org/surface-catalog";
import { applySpotlight, regionSlugs } from "../surfaceSpotlight";
import { body } from "./index";

const { Scene, techniques } = body;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("async-ui-states scene", () => {
  it("declares every technique of its catalog record as exactly one region", () => {
    const { container } = render(<Scene technique={null} reduced={false} volume={SURFACE_VOLUMES[0]} />);
    const record = surfaceRecord("async-ui-states");
    expect(record).toBeTruthy();
    for (const t of techniques) expect(container.querySelectorAll(`[data-technique="${t.slug}"]`), t.slug).toHaveLength(1);
    expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
    expect(new Set(regionSlugs(container)).size).toBe(techniques.length);
  });

  it("is spotlit by the frame's helper", () => {
    const { container } = render(<Scene technique={null} reduced={false} volume={SURFACE_VOLUMES[0]} />);
    applySpotlight(container, "failure-states");
    expect(container.querySelector('[data-technique="failure-states"]')?.getAttribute("data-spotlit")).toBe("true");
    expect(container.querySelector('[data-technique="state-model"]')?.classList.contains("opacity-40")).toBe(true);
  });

  it("renders the reduced path with the same regions, content in every one, and the ghost window kept", () => {
    const { container } = render(<Scene technique={techniques[0].slug} reduced={true} volume={SURFACE_VOLUMES[0]} />);
    expect(container.querySelector("[data-scene]")?.getAttribute("data-reduced")).toBe("true");
    expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
    for (const region of container.querySelectorAll("[data-technique]")) expect(region.textContent?.trim().length ?? 0).toBeGreaterThan(40);
    // The invisibility window is anti-flash, not decoration: it survives the motion-off path.
    const ghost = container.querySelector<HTMLElement>('[data-technique="placeholder-design"] [data-ghost]');
    expect(ghost?.style.animation).toContain("150ms");
    expect(ghost?.style.animation).toContain("async-hold");
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelectorAll('[data-technique="placeholder-design"] [data-entering="true"]')).toHaveLength(0);
  });

  it("renders at every fixture volume without throwing", () => {
    for (const volume of SURFACE_VOLUMES) {
      const { container, unmount } = render(<Scene technique={null} reduced={false} volume={volume} />);
      act(() => vi.advanceTimersByTime(1000));
      expect(container.querySelectorAll('[data-technique="placeholder-design"] [data-id]').length).toBeGreaterThan(0);
      expect(container.textContent).toContain(volume.toLocaleString());
      unmount();
    }
  });

  it("says its data is fiction", () => {
    render(<Scene technique={null} reduced={false} volume={SURFACE_VOLUMES[1]} />);
    expect(screen.getByText(/fixture data/i)).toBeTruthy();
    expect(screen.getByText(/nothing here is an ascent org/i)).toBeTruthy();
  });

  it("carries prose, a real source excerpt and an src/ evidence path for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length, t.slug).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length, t.slug).toBeGreaterThan(40);
      if (t.inAscent) expect(t.inAscent.file).toMatch(/^src\//);
    }
  });
});
