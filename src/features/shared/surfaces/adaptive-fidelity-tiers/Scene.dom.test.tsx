// @vitest-environment jsdom
//
// The fidelity scene under jsdom: it mounts inside the frame's MotionScope; every technique the body
// declares has a `[data-technique]` region; the reduced path renders every region with the probe NOT
// created and the drift paused; the fiction notice shows; the ladder moves under the window buttons
// and the strata field re-reads its row; the play control exists and the preference retires the probe.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord } from "@/lib/org/surface-catalog";
import { applySpotlight, regionSlugs } from "../surfaceSpotlight";
import { MotionScope } from "../surfaceMotionScope";
import { STRATA } from "./budgets";
import { body } from "./index";

const { Scene, techniques } = body;
const mount = (reduced: boolean, technique: string | null = null, volume: (typeof SURFACE_VOLUMES)[number] = SURFACE_VOLUMES[0]) =>
  render(
    <MotionScope reduced={reduced}>
      <Scene technique={technique} reduced={reduced} volume={volume} />
    </MotionScope>,
  );
const region = (c: HTMLElement, slug: string) => c.querySelector(`[data-technique="${slug}"]`) as HTMLElement;

describe("adaptive-fidelity-tiers scene", () => {
  it("declares every technique of its catalog record as exactly one region", () => {
    const { container } = mount(false);
    const record = surfaceRecord("adaptive-fidelity-tiers");
    expect(record).toBeTruthy();
    for (const t of techniques) expect(container.querySelectorAll(`[data-technique="${t.slug}"]`), t.slug).toHaveLength(1);
    expect(regionSlugs(container).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
  });

  it("is spotlit by the frame's helper", () => {
    const { container } = mount(false);
    applySpotlight(container, "asymmetric-tier-transitions");
    expect(region(container, "asymmetric-tier-transitions").getAttribute("data-spotlit")).toBe("true");
    expect(region(container, "per-tier-budget-tables").classList.contains("opacity-40")).toBe(true);
  });

  it("says its data is fiction and renders at every volume", () => {
    for (const v of SURFACE_VOLUMES) {
      const { unmount } = mount(false, null, v);
      expect(screen.getByText(/fixture data/i)).toBeTruthy();
      unmount();
    }
  });

  it("under reduced motion every region renders, the probe is never created, and the drift starts paused", () => {
    const { container } = mount(true, techniques[0].slug);
    expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
    expect(container.querySelector("[data-scene]")?.getAttribute("data-phase")).toBe("short-circuited");
    expect(container.querySelector("[data-probe-created]")?.getAttribute("data-probe-created")).toBe("false");
    expect(container.querySelector("[data-handle-idle]")?.getAttribute("data-handle-idle")).toBe("never created");
    const strata = container.querySelector("[data-strata-lines]") as HTMLElement;
    expect(strata.getAttribute("data-strata-lines")).toBe(String(STRATA.floor.lines));
    expect(strata.getAttribute("data-strata-drifting")).toBe("false");
    for (const t of techniques) expect(region(container, t.slug).textContent?.trim().length ?? 0).toBeGreaterThan(40);
  });

  it("starts unmeasured at the declared default; idle fires; three good windows are an arrival the strata field re-reads", () => {
    const { container } = mount(false);
    expect(container.querySelector("[data-measure-state]")?.getAttribute("data-measure-state")).toBe("unmeasured");
    expect(container.querySelector("[data-strata-lines]")?.getAttribute("data-strata-lines")).toBe(String(STRATA.reduced.lines));
    fireEvent.click(screen.getByLabelText("Idle arrives"));
    expect(container.querySelector("[data-handle-timeout]")?.getAttribute("data-handle-timeout")).toBe("cancelled by the winner");
    const ladder = region(container, "asymmetric-tier-transitions");
    for (let i = 0; i < 3; i++) fireEvent.click(within(ladder).getByLabelText("Close a good window"));
    expect(ladder.querySelector("[data-ladder]")?.getAttribute("data-ladder")).toBe("full");
    expect(container.querySelector("[data-scene]")?.getAttribute("data-tier")).toBe("full");
    expect(container.querySelector("[data-strata-lines]")?.getAttribute("data-strata-lines")).toBe(String(STRATA.full.lines));
    expect(container.querySelector("[data-measure-state]")?.getAttribute("data-measure-state")).toBe("measured");
    // One bad window: down at once, and the run is zeroed.
    fireEvent.click(within(ladder).getByLabelText("Close a bad window"));
    expect(container.querySelector("[data-scene]")?.getAttribute("data-tier")).toBe("reduced");
    expect(container.querySelector("[data-upgrade-run]")?.getAttribute("data-upgrade-run")).toBe("0");
    // The dead band resets the counter.
    fireEvent.click(within(ladder).getByLabelText("Close a good window"));
    fireEvent.click(within(ladder).getByLabelText("Close a neutral (dead band)"));
    expect(container.querySelector("[data-upgrade-run]")?.getAttribute("data-upgrade-run")).toBe("0");
    // A straddled window is discarded.
    fireEvent.click(screen.getByLabelText("Close a window that straddled a visibility change"));
    expect(container.querySelector("[data-verdict]")?.getAttribute("data-verdict")).toBe("discarded");
  });

  it("the play control is visible and pausable; a stated preference retires the probe and auto brings it back fresh", () => {
    const { container } = mount(false);
    const play = screen.getByLabelText("Play the scripted session");
    fireEvent.click(play);
    expect(screen.getByLabelText("Pause the scripted session")).toBeTruthy();
    expect(container.querySelector("[data-wakeup]")?.getAttribute("data-wakeup")).toBe("armed");
    fireEvent.click(screen.getByLabelText("Pause the scripted session"));
    expect(container.querySelector("[data-wakeup]")?.getAttribute("data-wakeup")).toBe("none");
    const control = within(region(container, "preference-short-circuits-measurement")).getByRole("group", { name: "Quality control" });
    fireEvent.click(within(control).getByRole("button", { name: "floor" }));
    expect(container.querySelector("[data-scene]")?.getAttribute("data-phase")).toBe("short-circuited");
    expect(container.querySelector("[data-scene]")?.getAttribute("data-tier")).toBe("floor");
    expect(container.querySelector("[data-probe-created]")?.getAttribute("data-probe-created")).toBe("false");
    fireEvent.click(within(control).getByRole("button", { name: "auto (measured)" }));
    expect(container.querySelector("[data-scene]")?.getAttribute("data-phase")).toBe("unmeasured");
    expect(container.querySelector("[data-scene]")?.getAttribute("data-tier")).toBe("reduced");
  });

  it("carries a real source excerpt and prose for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length).toBeGreaterThan(40);
    }
  });
});
