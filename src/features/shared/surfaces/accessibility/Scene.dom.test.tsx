// @vitest-environment jsdom
//
// The accessibility scene under jsdom: every technique the body declares has a `[data-technique]`
// region matching the catalog record; the reduced path renders the same regions; the fiction line
// shows; every volume mounts. Then the mechanisms, asserted through what a screen reader would
// receive rather than through pixels: roving focus by identity, the drawer's tab-stop probe per hide
// mechanism, the announcer's drain order and keyed remount, the name chain, the failed-run gate.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord } from "@/lib/org/surface-catalog";
import { regionSlugs } from "../surfaceSpotlight";
import { body } from "./index";

const { Scene, techniques } = body;
const mount = (reduced = false, volume: (typeof SURFACE_VOLUMES)[number] = SURFACE_VOLUMES[0]) => render(<Scene technique={null} reduced={reduced} volume={volume} />);
const region = (c: HTMLElement, slug: string) => c.querySelector(`[data-technique="${slug}"]`) as HTMLElement;

afterEach(() => vi.useRealTimers());

describe("accessibility scene", () => {
  it("declares every technique of its catalog record as exactly one region", () => {
    const { container } = mount();
    const record = surfaceRecord("accessibility");
    expect(record).toBeTruthy();
    const slugs = regionSlugs(container);
    for (const t of techniques) expect(slugs.filter((s) => s === t.slug), t.slug).toHaveLength(1);
    expect(slugs).toHaveLength(techniques.length);
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
  });

  it("renders the reduced path with the same regions, and mounts at every volume", () => {
    const { container } = mount(true);
    expect(container.querySelector("[data-scene]")?.getAttribute("data-reduced")).toBe("true");
    expect(regionSlugs(container)).toHaveLength(techniques.length);
    expect(container.querySelector("[data-signal-reduced]")?.textContent).toBe("reduce");
    for (const v of SURFACE_VOLUMES) expect(() => mount(false, v)).not.toThrow();
  });

  it("says its data is fiction", () => {
    mount(false, SURFACE_VOLUMES[1]);
    expect(screen.getAllByText(/fixture data/i).length).toBeGreaterThan(0);
  });

  it("roving strip: one stop, arrows move focus and selection by identity, resort keeps the member", () => {
    const { container } = mount();
    const strip = region(container, "keyboard-navigation-models");
    const toolbar = within(strip).getByRole("toolbar");
    const stops = () => within(toolbar).getAllByRole("button").filter((b) => b.tabIndex === 0);
    expect(stops()).toHaveLength(1);
    fireEvent.keyDown(toolbar, { key: "ArrowRight" });
    expect(toolbar.getAttribute("data-roving-active")).toBe("platform");
    expect(document.activeElement?.textContent).toBe("Platform");
    fireEvent.click(within(strip).getByText("resort"));
    expect(toolbar.getAttribute("data-roving-active")).toBe("platform"); // identity survived the resort
    expect(stops()).toHaveLength(1);
    fireEvent.click(within(strip).getByText("remove active member"));
    expect(toolbar.getAttribute("data-roving-active")).not.toBe("platform");
    expect(stops()).toHaveLength(1); // nearest survivor took the stop
  });

  it("drawer: inert and hidden leave zero stops inside; opacity-only leaks them", () => {
    const { container } = mount();
    const drawer = region(container, "hidden-but-mounted-inertness");
    const stops = () => drawer.querySelector("[data-stops]")?.getAttribute("data-stops");
    expect(stops()).toBe("0");
    expect(drawer.querySelector("#a11y-drawer")?.hasAttribute("inert")).toBe(true);
    fireEvent.click(within(drawer).getByText("opacity"));
    expect(stops()).toBe("2");
    expect(drawer.querySelector("[data-drawer-verdict]")?.getAttribute("data-drawer-verdict")).toBe("leak");
    fireEvent.click(within(drawer).getByText("hidden"));
    expect(stops()).toBe("0");
    fireEvent.click(within(drawer).getByText("open details"));
    expect(stops()).toBe("2");
    expect(document.activeElement?.tagName).toBe("TEXTAREA"); // focus entered after it became operable
  });

  it("announcer: regions exist before the news, bursts drain in order, repeats remount", () => {
    vi.useFakeTimers();
    const { container } = mount();
    const a = region(container, "live-region-architecture");
    expect(a.querySelector("[data-live-polite]")).toBeTruthy();
    expect(a.querySelector("[data-live-polite]")?.textContent).toBe("");
    fireEvent.click(within(a).getByText("burst x3"));
    expect(a.querySelector("[data-queued]")?.getAttribute("data-queued")).toBe("3");
    act(() => vi.advanceTimersByTime(160));
    expect(a.querySelector("[data-live-polite]")?.textContent).toBe("Scan 1 of 3 finished.");
    // One utterance per drain tick: the next timer is scheduled after the commit that popped the last.
    act(() => vi.advanceTimersByTime(160));
    expect(a.querySelector("[data-live-polite]")?.textContent).toBe("Scan 2 of 3 finished.");
    act(() => vi.advanceTimersByTime(160));
    expect(a.querySelector("[data-voiced]")?.getAttribute("data-voiced")).toBe("3");
    const first = a.querySelector("[data-live-polite] span");
    fireEvent.click(within(a).getByText("repeat last"));
    act(() => vi.advanceTimersByTime(160));
    const second = a.querySelector("[data-live-polite] span");
    expect(second?.textContent).toBe("Scan 3 of 3 finished.");
    expect(second).not.toBe(first); // keyed remount: a fresh node, so an identical repeat is a mutation
    fireEvent.click(within(a).getByText("assertive: save failed"));
    act(() => vi.advanceTimersByTime(160));
    expect(a.querySelector("[data-live-assertive]")?.textContent).toContain("Save failed");
  });

  it("form: the inspector names the source, the error joins the described-by chain and is voiced", () => {
    vi.useFakeTimers();
    const { container } = mount();
    const f = region(container, "name-and-description-wiring");
    const cell = (id: string) => f.querySelector(`[data-inspect-for="${id}"]`) as HTMLElement;
    expect(cell("a11y-title").getAttribute("data-source")).toBe("label");
    expect(cell("a11y-save").getAttribute("data-name")).toMatch(/^Save/); // label-in-name
    expect(cell("a11y-delete").getAttribute("data-source")).toBe("aria-label");
    fireEvent.click(within(f).getByText("placeholder"));
    expect(cell("a11y-title").getAttribute("data-source")).toBe("placeholder");
    fireEvent.click(within(f).getByText("Save"));
    const input = f.querySelector("#a11y-title") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain("a11y-title-error");
    expect(cell("a11y-title").textContent).toContain("Title is required.");
    act(() => vi.advanceTimersByTime(160));
    expect(container.querySelector("[data-live-assertive]")?.textContent).toBe("Title is required.");
  });

  it("gates: a run over the scene clears the floor; a run over nothing is a failed run, not a pass", () => {
    const { container } = mount();
    const g = region(container, "a11y-verification");
    fireEvent.click(within(g).getByText("run gates"));
    expect(g.querySelector("[data-gate-verdict]")?.getAttribute("data-gate-verdict")).toBe("floor cleared");
    expect(Number(g.querySelector("[data-gate-examined]")?.getAttribute("data-gate-examined"))).toBeGreaterThan(20);
    fireEvent.click(within(g).getByText("an empty selector"));
    fireEvent.click(within(g).getByText("run gates"));
    expect(g.querySelector("[data-gate-verdict]")?.getAttribute("data-gate-verdict")).toBe("failed run");
  });

  it("worklist: deleting a row hands focus to the survivor, and the pairing workaround refuses deletion", () => {
    const { container } = mount();
    const w = region(container, "primitive-level-a11y");
    const first = w.querySelector("[data-row-id]")?.getAttribute("data-row-id");
    fireEvent.click(within(w).getAllByRole("button", { name: /^Delete / })[0]!);
    // The identity is gone (the window slides the next follow-up in), and focus sits on a survivor row.
    expect(w.querySelector(`[data-row-id="${first}"]`)).toBeNull();
    expect(document.activeElement?.closest("[data-row-id]")).toBeTruthy();
    const p = region(container, "assistive-tech-divergence");
    fireEvent.click(within(p).getByText("propose deleting it"));
    expect(p.querySelector("[data-deletion]")?.getAttribute("data-deletion")).toBe("refused");
    expect(p.querySelectorAll("[data-pairing-untested]").length).toBeGreaterThan(0);
  });

  it("carries prose and a real source excerpt for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length).toBeGreaterThan(40);
    }
  });
});
