// @vitest-environment jsdom
//
// The motion scene under jsdom: it mounts inside the frame's MotionScope; every technique the body
// declares has a `[data-technique]` region (so the frame can spotlight it); the reduced path renders
// the content-bearing end state on the first frame with an honest liveness label; the one-shot guard
// does not replay on poll; the merged pause signal reads the user stop.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord } from "@/lib/org/surface-catalog";
import { applySpotlight, regionSlugs } from "../surfaceSpotlight";
import { MotionScope } from "../surfaceMotionScope";
import { HEADLINE_FIGURE, HEADLINE_TEXT } from "./fixtures";
import { body } from "./index";

const { Scene, techniques } = body;
const mount = (reduced: boolean, technique: string | null = null) =>
  render(
    <MotionScope reduced={reduced}>
      <Scene technique={technique} reduced={reduced} volume={SURFACE_VOLUMES[0]} />
    </MotionScope>,
  );

describe("motion scene", () => {
  it("declares every technique of its catalog record as a region", () => {
    const { container } = mount(false);
    const record = surfaceRecord("motion");
    expect(record).toBeTruthy();
    const regions = new Set(regionSlugs(container));
    for (const t of techniques) expect(regions.has(t.slug), `missing region for ${t.slug}`).toBe(true);
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
  });

  it("is spotlit by the frame's helper: the selected region ringed, the rest dimmed", () => {
    const { container } = mount(false);
    applySpotlight(container, "taste-budgets");
    const spot = container.querySelector('[data-technique="taste-budgets"]');
    const other = container.querySelector('[data-technique="preset-vocabulary"]');
    expect(spot?.getAttribute("data-spotlit")).toBe("true");
    expect(spot?.classList.contains("ring-accent")).toBe(true);
    expect(other?.classList.contains("opacity-40")).toBe(true);
    applySpotlight(container, null);
    expect(other?.classList.contains("opacity-40")).toBe(false);
  });

  it("renders the content-bearing end state immediately under reduced motion, labelled honestly", () => {
    const { container } = mount(true);
    expect(container.querySelector("[data-scene]")?.getAttribute("data-reduced")).toBe("true");
    const region = container.querySelector('[data-technique="content-bearing-degradation"]') as HTMLElement;
    expect(within(region).getByText(HEADLINE_FIGURE.toLocaleString())).toBeTruthy();
    expect(within(region).getByText(HEADLINE_TEXT)).toBeTruthy();
    expect(region.querySelector("[data-liveness]")?.getAttribute("data-liveness")).toBe("static value");
    // Reduced is a veto in the merged pause signal.
    expect(container.querySelector("[data-merged]")?.getAttribute("data-merged")).toBe("paused");
    expect(container.querySelector('[data-decider="reduced"]')?.getAttribute("data-veto")).toBe("true");
  });

  it("one-shot: a poll re-delivers known identities without replaying their entrance", () => {
    const { container } = mount(false);
    const region = container.querySelector('[data-technique="one-shot-guarding"]') as HTMLElement;
    const entering = () => Number(region.querySelector("[data-entering]")?.getAttribute("data-entering"));
    // The entrance itself writes the seen-set, on animationend (jsdom runs no animations, so fire it).
    const settle = () => region.querySelectorAll('[data-entered="now"]').forEach((li) => fireEvent(li, new Event("animationend", { bubbles: true })));
    expect(entering()).toBeGreaterThan(0); // first arrival: the window enters
    settle();
    expect(entering()).toBe(0);
    fireEvent.click(within(region).getByText("poll"));
    expect(entering()).toBe(0); // poll #1: same ids, nothing re-enters
    fireEvent.click(within(region).getByText("poll"));
    expect(entering()).toBe(1); // poll #2: exactly one genuinely new identity
    settle();
    fireEvent.click(within(region).getByText("change context"));
    expect(entering()).toBeGreaterThan(1); // the one reset policy
  });

  it("performance: the sweep under reduced motion settles at once without scheduling a loop", () => {
    const { container } = mount(true);
    const region = container.querySelector('[data-technique="performance-discipline"]') as HTMLElement;
    fireEvent.click(within(region).getByText("run 2s sweep"));
    expect(region.querySelector("[data-sweep-state]")?.getAttribute("data-sweep-state")).toBe("settled");
  });

  it("the stop is one-directional and the labelled resume lifts it", () => {
    const { container } = mount(false);
    const stop = screen.getByLabelText("Stop the loop");
    const resume = screen.getByLabelText("Resume the loop");
    expect(container.querySelector("[data-merged]")?.getAttribute("data-merged")).toBe("running");
    fireEvent.click(stop);
    expect(container.querySelector('[data-decider="user-stop"]')?.getAttribute("data-veto")).toBe("true");
    expect((stop as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(resume);
    expect(container.querySelector("[data-merged]")?.getAttribute("data-merged")).toBe("running");
  });

  it("the budget meter turns over past the entrance cap", () => {
    const { container } = mount(false);
    const region = container.querySelector('[data-technique="taste-budgets"]') as HTMLElement;
    expect(region.querySelector("[data-budget-state]")?.getAttribute("data-budget-state")).toBe("within");
    fireEvent.change(within(region).getByLabelText("Per-item entrance duration"), { target: { value: "1400" } });
    expect(region.querySelector("[data-budget-state]")?.getAttribute("data-budget-state")).toBe("over");
  });
});
