// @vitest-environment jsdom
//
// The search scene under jsdom: it mounts inside the frame's MotionScope; every technique the body
// declares has exactly one `[data-technique]` region; every volume renders; the reduced path renders
// the same regions; the fiction line shows; and the mechanisms hold — chips reflect the parse, the
// ladder labels its rung, failure is not empty, filters reset the page, deletions drift the grow-only
// index, a dead view clause withholds, the palette runs the top hit on enter, an ill-typed rule is refused.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
const attr = (c: ParentNode, sel: string, name: string) => c.querySelector(sel)?.getAttribute(name);
const type = (text: string) => fireEvent.change(screen.getByLabelText("Search repositories"), { target: { value: text } });

describe("search scene", () => {
  it("declares every technique of its catalog record as a region, once, and says its data is fiction", () => {
    const { container } = mount(false);
    const record = surfaceRecord("search");
    expect(record).toBeTruthy();
    const regions = regionSlugs(container);
    for (const t of techniques) expect(regions.filter((s) => s === t.slug), `region for ${t.slug}`).toHaveLength(1);
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
    expect(screen.getByText(/fixture data/i)).toBeTruthy();
  });

  it("renders at every volume and under reduced motion", () => {
    for (const v of SURFACE_VOLUMES) {
      const { container, unmount } = mount(false, v);
      expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
      expect(container.querySelectorAll("[data-result]").length).toBeGreaterThan(0);
      unmount();
    }
    const { container } = mount(true);
    expect(attr(container, "[data-scene]", "data-reduced")).toBe("true");
    expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("is spotlit by the frame's helper", () => {
    const { container } = mount(false);
    applySpotlight(container, "saved-views");
    expect(region(container, "saved-views").getAttribute("data-spotlit")).toBe("true");
    expect(region(container, "command-surface").classList.contains("opacity-40")).toBe(true);
  });

  it("door: chips reflect the parse, the ladder labels its rung, and failure is not an empty result", () => {
    const { container } = mount(false);
    type('status:fail -lang:go "session events" a');
    const box = region(container, "query-parsing");
    expect(box.querySelectorAll("[data-clause]")).toHaveLength(2);
    expect(box.querySelector('[data-clause="lang"]')?.textContent).toMatch(/^not lang/);
    expect(box.querySelector("[data-phrase]")?.textContent).toBe("“session events”");
    expect(attr(box, "[data-search-state]", "data-search-state")).toBe("ok");
    expect(attr(box, "[data-rung]", "data-rung")).toBe("0");
    expect(within(box).getByText(/"a"/)).toBeTruthy(); // refused by the door, reported
    type("note:keep");
    expect(within(box).getByText("note:keep")).toBeTruthy(); // an unknown prefix stays literal, and says so
    type("indexi");
    expect(attr(box, "[data-rung]", "data-rung")).toBe("3");
    expect(attr(box, "[data-search-state]", "data-search-state")).toBe("degraded");
    type("zzzz");
    expect(attr(box, "[data-search-state]", "data-search-state")).toBe("empty");
    fireEvent.click(within(box).getByText("simulate engine failure"));
    expect(attr(box, "[data-search-state]", "data-search-state")).toBe("failure");
    expect(within(box).getByRole("alert")).toBeTruthy();
    fireEvent.click(within(box).getByText("retry"));
    expect(attr(box, "[data-search-state]", "data-search-state")).toBe("empty");
  });

  it("ranking: marks come from the engine, so a prefix match highlights the inflected token", () => {
    const { container } = mount(false);
    type("indexi");
    const marks = container.querySelectorAll("[data-results] mark");
    expect(marks.length).toBeGreaterThan(0);
    expect([...marks].some((m) => m.textContent === "indexing")).toBe(true);
    expect(Number(attr(container, "[data-marks-engine]", "data-marks-engine"))).toBeGreaterThan(Number(attr(container, "[data-marks-naive]", "data-marks-naive")));
  });

  it("facets: the default is a chip, a pick narrows, resets the page, and clear-all returns to the default", () => {
    const { container } = mount(false);
    const facets = region(container, "faceting-and-filters");
    expect(attr(facets, "[data-chip-default]", "data-chip-default")).toBe("true");
    expect(attr(facets, "[data-narrowed]", "data-narrowed")).toBe("false");
    fireEvent.click(within(container).getByText("next →"));
    fireEvent.click(within(facets).getByLabelText("lang python"));
    expect(attr(facets, "[data-narrowed]", "data-narrowed")).toBe("true");
    expect(container.textContent).toContain("page 1 of");
    expect(Number(attr(facets, "[data-page-resets]", "data-page-resets"))).toBeGreaterThan(0);
    fireEvent.click(within(facets).getByText("clear all"));
    expect(attr(facets, "[data-narrowed]", "data-narrowed")).toBe("false");
  });

  it("index: a grow-only index drifts on delete, produces a ghost, and the rebuild reconciles", () => {
    const { container } = mount(false);
    const idx = region(container, "full-text-indexing");
    fireEvent.click(within(idx).getByText("index only grows"));
    fireEvent.click(within(idx).getByText("delete top result"));
    expect(attr(idx, "[data-drift]", "data-drift")).toBe("true");
    expect(attr(idx, "[data-ghosts]", "data-ghosts")).toBe("1");
    fireEvent.click(within(idx).getByText("rebuild from source"));
    expect(attr(idx, "[data-drift]", "data-drift")).toBe("false");
    expect(attr(idx, "[data-ghosts]", "data-ghosts")).toBe("0");
    fireEvent.click(within(idx).getByText("split identifier humps"));
    expect(attr(idx, '[data-tokens="authService"]', "data-tokens")).toBe("authService");
    expect(idx.querySelector('[data-tokens="authService"]')?.textContent).toBe("authservice");
  });

  it("views: a retired clause is dead and withholds results; repair drops it; tweaks mark the view modified", () => {
    const { container } = mount(false);
    const views = region(container, "saved-views");
    fireEvent.click(within(views).getByText("Gold tier (2025)"));
    expect(attr(views, "[data-dead-clauses]", "data-dead-clauses")).toBe("1");
    expect(container.querySelectorAll("[data-result]")).toHaveLength(0);
    expect(attr(views, "[data-dirty]", "data-dirty")).toBe("false");
    fireEvent.click(within(views).getByText("drop the dead clause"));
    expect(views.querySelector("[data-dead-clauses]")).toBeNull();
    expect(container.querySelectorAll("[data-result]").length).toBeGreaterThan(0);
    type("auth");
    expect(attr(views, "[data-dirty]", "data-dirty")).toBe("true");
    fireEvent.click(within(views).getByText("revert"));
    expect(attr(views, "[data-dirty]", "data-dirty")).toBe("false");
  });

  it("palette: enter runs the top hit, the ledger records it, escape leaves state alone", () => {
    const { container } = mount(false);
    const pal = region(container, "command-surface");
    fireEvent.click(within(pal).getByText(/open palette/));
    const input = within(pal).getByLabelText("Palette query");
    fireEvent.change(input, { target: { value: "sor" } });
    expect(Number(attr(pal, "[data-palette-rejected]", "data-palette-rejected"))).toBeGreaterThan(0);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(attr(pal, "[data-palette-last]", "data-palette-last")).toMatch(/^cmd:sort/);
    fireEvent.click(within(pal).getByText(/open palette/));
    fireEvent.keyDown(within(pal).getByLabelText("Palette query"), { key: "Escape" });
    expect(pal.querySelector("#search-palette")).toBeNull();
  });

  it("rules: an ill-typed rule is refused at the node; a persisted rule under a retired field is broken at load", () => {
    const { container } = mount(false);
    const rules = region(container, "typed-filter-language");
    expect(attr(rules, "[data-verdict]", "data-verdict")).toBe("ok");
    fireEvent.change(within(rules).getByLabelText("Filter rule"), { target: { value: "tags < 5" } });
    expect(attr(rules, "[data-verdict]", "data-verdict")).toBe("refused");
    expect(rules.textContent).toContain("problem occurred here: tags < 5");
    expect(rules.querySelectorAll('[data-rule-load="broken"]')).toHaveLength(1);
    expect(rules.querySelectorAll('[data-validity="disagrees"]')).toHaveLength(0);
  });
});
