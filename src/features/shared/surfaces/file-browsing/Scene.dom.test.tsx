// @vitest-environment jsdom
//
// The vault browser under jsdom: it mounts inside the frame's MotionScope; every technique the body
// declares has exactly one `[data-technique]` region; the reduced path renders the same regions;
// every SURFACE_VOLUMES value renders without throwing; the fiction line shows. Then the mechanisms:
// empty vs unreadable listings are spelled differently; the sync agent makes the view stale and a
// refresh drops vanished selections by identity; a rename against a vanished file gets the "gone"
// verdict; restart hydrates by identity and relocates a vanished location; a stranded filter is disclosed.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord } from "@/lib/org/surface-catalog";
import { regionSlugs } from "../surfaceSpotlight";
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
const attr = (c: HTMLElement, sel: string, name: string) => c.querySelector(sel)?.getAttribute(name);

describe("file-browsing scene", () => {
  it("declares every technique of its catalog record as exactly one region", () => {
    const { container } = mount(false);
    const record = surfaceRecord("file-browsing");
    expect(record).toBeTruthy();
    const regions = regionSlugs(container);
    for (const t of techniques) expect(regions.filter((s) => s === t.slug), `region for ${t.slug}`).toHaveLength(1);
    expect(regions).toHaveLength(techniques.length);
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
  });

  it("renders the reduced path with the same regions and the fiction line", () => {
    const { container } = mount(true);
    expect(container.querySelector("[data-scene]")?.getAttribute("data-reduced")).toBe("true");
    expect(regionSlugs(container)).toHaveLength(techniques.length);
    expect(screen.getByText(/fixture data/i)).toBeTruthy();
  });

  it("renders at every volume without throwing, mounting only a window", () => {
    for (const v of SURFACE_VOLUMES) {
      const { container, unmount } = mount(false, v);
      expect(container.querySelectorAll("[data-row]").length).toBeLessThanOrEqual(40);
      fireEvent.click(within(container.querySelector('[role="tree"]') as HTMLElement).getByText("assets"));
      expect(container.querySelectorAll("[data-row]").length).toBeLessThanOrEqual(40);
      expect(container.querySelector("[data-listing-status]")?.getAttribute("data-listing-status")).toBe("ok");
      unmount();
    }
  });

  it("spells empty and unreadable differently", () => {
    const { container } = mount(false);
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    fireEvent.click(within(tree).getByText("scratch"));
    expect(attr(container, "[data-listing-status]", "data-listing-status")).toBe("empty");
    fireEvent.click(within(tree).getByText(/^system/));
    expect(attr(container, "[data-listing-status]", "data-listing-status")).toBe("unreadable");
  });

  it("the sync agent makes the view stale; refresh drops vanished ids and keeps the rest", () => {
    const { container } = mount(false);
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    fireEvent.click(within(tree).getByText("assets"));
    fireEvent.click(within(container).getByText(/select all loaded/));
    const before = Number(attr(container, "[data-selected-count]", "data-selected-count"));
    expect(before).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Another writer changes the store"));
    expect(attr(container, "[data-stale]", "data-stale")).toBe("true");
    expect(Number(attr(container, "[data-selected-count]", "data-selected-count"))).toBe(before); // the view has not re-aimed yet
    fireEvent.click(screen.getByLabelText("Refresh the listing"));
    expect(attr(container, "[data-stale]", "data-stale")).toBe("false");
    expect(Number(attr(container, "[data-dropped]", "data-dropped"))).toBe(1);
    expect(Number(attr(container, "[data-selected-count]", "data-selected-count"))).toBe(before - 1);
  });

  it("a rename against a file the other writer deleted gets the typed 'gone' verdict, and the view refreshes", () => {
    const { container } = mount(false);
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    fireEvent.click(within(tree).getByText("knowledge"));
    fireEvent.click(screen.getByLabelText("Another writer changes the store"));
    const line = within(region(container, "listing-and-refresh")).getByText(/· deleted /).textContent ?? "";
    const deletedName = line.replace(/.*· deleted /, "").trim();
    // The stale listing still shows the ghost row; aim at it and fire.
    const ghost = Array.from(container.querySelectorAll("[data-row]")).find((r) => r.textContent?.includes(deletedName)) as HTMLElement;
    expect(ghost).toBeTruthy();
    fireEvent.click(ghost.firstElementChild as HTMLElement);
    fireEvent.change(screen.getByLabelText("New name"), { target: { value: "renamed.md" } });
    expect(attr(container, "[data-preflight]", "data-preflight")).toBe("gone"); // preflight already sees the live store
    fireEvent.click(within(region(container, "file-mutations")).getByText("rename"));
    expect(attr(container, "[data-verdict]", "data-verdict")).toBe("gone");
    expect(attr(container, "[data-stale]", "data-stale")).toBe("false"); // the failure refreshed the view
    expect(container.querySelector(`[data-row="${ghost.getAttribute("data-row")}"]`)).toBeNull();
  });

  it("trash goes through the guard door, reports per item, and restore brings the file back", () => {
    const { container } = mount(false);
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    fireEvent.click(within(tree).getByText("skills"));
    const rows = container.querySelectorAll("[data-row]");
    fireEvent.click(rows[0]!.firstElementChild as HTMLElement);
    fireEvent.click(rows[2]!.firstElementChild as HTMLElement, { shiftKey: true });
    expect(attr(container, "[data-selected-count]", "data-selected-count")).toBe("3");
    fireEvent.click(screen.getByLabelText("Trash selected"));
    expect(attr(container, "[data-report]", "data-report")).toBe("trash");
    expect(container.querySelectorAll('[data-outcome="trashed"]')).toHaveLength(3);
    expect(attr(container, "[data-trash-count]", "data-trash-count")).toBe("3");
    fireEvent.click(screen.getAllByLabelText(/^Restore /)[0]!);
    expect(attr(container, "[data-trash-count]", "data-trash-count")).toBe("2");
  });

  it("restart hydrates the map by identity and relocates a vanished location to its ancestor", () => {
    const { container } = mount(false);
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    fireEvent.click(within(tree).getByText("assets"));
    fireEvent.click(within(tree).getByText("renders"));
    expect(container.querySelector("[data-nav-blob]")?.textContent).toContain('"location":"d-renders"');
    // Inside a small nested folder the other writer removes the folder itself; the blob still names it.
    fireEvent.click(screen.getByLabelText("Another writer changes the store"));
    expect(within(region(container, "navigation-state")).getByText(/location gone/)).toBeTruthy();
    fireEvent.click(within(region(container, "navigation-state")).getByText(/simulate restart/));
    expect(attr(container, "[data-restore-report]", "data-restore-report")).toBe("relocated");
    expect(within(region(container, "navigation-state")).getByText(/assets \(nearest surviving ancestor\)/)).toBeTruthy();
    expect(attr(container, "[data-listing-status]", "data-listing-status")).toBe("ok");
  });

  it("a stranded kind filter is disclosed instead of leaving a silent void", () => {
    const { container } = mount(false);
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    fireEvent.click(within(tree).getByText("scratch"));
    fireEvent.click(container.querySelector('[data-kind-chip="audio"]') as HTMLElement);
    expect(attr(container, "[data-stranded]", "data-stranded")).toBe("audio");
    fireEvent.click(within(region(container, "kind-taxonomy")).getByText("clear"));
    expect(container.querySelector("[data-filter-banner]")).toBeNull();
  });

  it("previews: a corrupt image's failure is cached, one tile, and rewriting the bytes invalidates by version", () => {
    const { container } = mount(false, SURFACE_VOLUMES[1]);
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    fireEvent.click(within(tree).getByText("assets"));
    fireEvent.click(container.querySelector('[data-kind-chip="image"]') as HTMLElement); // the window is now images only
    const failed = container.querySelector('[data-thumb="failed"]');
    expect(failed).toBeTruthy();
    expect(Number(attr(container, "[data-cache-failures]", "data-cache-failures"))).toBeGreaterThan(0);
    const name = failed?.getAttribute("title") ?? "";
    const row = Array.from(container.querySelectorAll("[data-row]")).find((r) => r.textContent?.includes(name)) as HTMLElement;
    fireEvent.click(row.firstElementChild as HTMLElement);
    expect(attr(container, "[data-rung]", "data-rung")).toBe("1");
    fireEvent.click(screen.getByLabelText("Rewrite the focused file's bytes"));
    expect(attr(container, "[data-rung]", "data-rung")).toBe("3");
  });

  it("carries prose, a real source excerpt, and honest evidence for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length).toBeGreaterThan(40);
      if (t.inAscent) expect(t.inAscent.file).toMatch(/^src\//);
    }
  });
});
