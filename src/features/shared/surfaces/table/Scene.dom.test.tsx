// @vitest-environment jsdom
//
// The table scene under jsdom: it mounts, every declared technique has exactly one `[data-technique]`
// region, the reduced path renders the same regions with the ghost delay kept, every fixture volume
// renders, the fiction line shows — and the behaviours the drawer points at hold: the body state
// machine (ghost → populated → refreshing over rows → error over rows keeps them; empty only after
// settling), the sort contract (one aria-sort, the cycle, zero rows moved on a resort, selection by
// identity), the walk ledger (offset repeats after an insert, keyset does not), the render log (one
// toggle, one row).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord } from "@/lib/org/surface-catalog";
import { applySpotlight, regionSlugs } from "../surfaceSpotlight";
import { LATENCY_MS } from "./useLedger";
import { body } from "./index";

const { Scene, techniques } = body;
const mount = (reduced = false, volume: (typeof SURFACE_VOLUMES)[number] = SURFACE_VOLUMES[0]) => render(<Scene technique={null} reduced={reduced} volume={volume} />);
const settle = () => act(() => vi.advanceTimersByTime(LATENCY_MS + 10));
const region = (c: HTMLElement, slug: string) => c.querySelector(`[data-technique="${slug}"]`) as HTMLElement;
const bodyState = (c: HTMLElement) => c.querySelector("[data-body-state]")?.getAttribute("data-body-state");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("table scene", () => {
  it("declares every technique of its catalog record as exactly one region", () => {
    const { container } = mount();
    const record = surfaceRecord("table");
    expect(record).toBeTruthy();
    for (const t of techniques) expect(container.querySelectorAll(`[data-technique="${t.slug}"]`), t.slug).toHaveLength(1);
    expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
    expect(new Set(regionSlugs(container)).size).toBe(techniques.length);
    applySpotlight(container, "pagination");
    expect(region(container, "pagination").getAttribute("data-spotlit")).toBe("true");
    expect(region(container, "sorting").classList.contains("opacity-40")).toBe(true);
  });

  it("renders the reduced path: same regions, content in each, the ghost delay kept, rows settle without motion", () => {
    const { container } = mount(true);
    expect(container.querySelector("[data-scene]")?.getAttribute("data-reduced")).toBe("true");
    expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
    for (const r of container.querySelectorAll("[data-technique]")) expect(r.textContent?.trim().length ?? 0).toBeGreaterThan(40);
    const ghost = container.querySelector<HTMLElement>("[data-ghost]");
    expect(ghost?.style.animation).toContain("150ms");
    expect(ghost?.style.animation).toContain("ledger-hold");
    settle();
    const row = container.querySelector<HTMLElement>("[data-id]") as HTMLElement;
    expect(row.style.animation).toContain("1ms"); // epsilon, never zero: animationend still marks the seen-set
    expect(row.getAttribute("data-entered")).toBe("now");
    fireEvent(row, new Event("animationend", { bubbles: true }));
    expect(row.getAttribute("data-entered")).toBe("settled");
  });

  it("renders at every fixture volume; the all-client bet is refused past its bound", () => {
    for (const volume of SURFACE_VOLUMES) {
      const { container, unmount } = mount(false, volume);
      expect(screen.getByText(/fixture data/i)).toBeTruthy();
      expect(container.textContent).toContain(volume.toLocaleString());
      settle();
      expect(container.querySelectorAll("[data-id]")).toHaveLength(25);
      const split = region(container, "client-server-split");
      const clientBtn = within(split).getByRole("button", { name: "all-client" }) as HTMLButtonElement;
      expect(clientBtn.disabled).toBe(volume > 5_000);
      expect(split.querySelector("[data-bet]")?.getAttribute("data-bet")).toBe(volume > 5_000 ? "expired" : volume === 5_000 ? "at the bound" : "within");
      unmount();
    }
  });

  it("body state: ghost under the chrome, rows never yield to a refresh, error over rows keeps them, empty only after settling", () => {
    const { container } = mount();
    expect(bodyState(container)).toBe("empty-loading");
    expect(container.querySelectorAll("th")).toHaveLength(6); // chrome renders first
    expect(container.querySelectorAll("[data-ghost]").length).toBeGreaterThan(0);
    settle();
    expect(bodyState(container)).toBe("populated");
    const ledger = region(container, "loading-and-empty-states");
    fireEvent.click(within(ledger).getByText("refresh"));
    expect(bodyState(container)).toBe("populated-refreshing");
    expect(container.querySelectorAll("[data-id]")).toHaveLength(25); // no placeholder over data
    settle();
    fireEvent.click(within(ledger).getByLabelText("fail the next fetch"));
    fireEvent.click(within(ledger).getByText("refresh"));
    settle();
    expect(container.querySelectorAll("[data-id]")).toHaveLength(25); // a failed refresh keeps the rows
    expect(ledger.textContent).toContain("refresh failed");
    const search = within(region(container, "client-server-split")).getByPlaceholderText("name contains…");
    fireEvent.change(search, { target: { value: "zzzz-nothing" } });
    expect(bodyState(container)).toBe("empty-settled");
    expect(ledger.textContent).toContain("No repositories matching “zzzz-nothing”");
  });

  it("sorting: one announced header, a predictable cycle, zero rows moved on a resort, selection by identity", () => {
    const { container } = mount();
    settle();
    const sorted = () => container.querySelectorAll("th[aria-sort]");
    expect(sorted()).toHaveLength(1);
    expect(sorted()[0].getAttribute("aria-sort")).toBe("descending");
    const firstId = container.querySelector("[data-id]")?.getAttribute("data-id") ?? "";
    fireEvent.click(within(container.querySelector("[data-id]") as HTMLElement).getByRole("checkbox"));
    const commits = screen.getByRole("button", { name: /^Commits/ });
    fireEvent.click(commits);
    expect(sorted()).toHaveLength(1);
    expect(sorted()[0].getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(screen.getByRole("button", { name: /^Commits/ }));
    expect(sorted()[0].getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: /^Commits/ }));
    expect(container.querySelector("[data-sort]")?.getAttribute("data-sort")).toBe("score:desc"); // the named default
    fireEvent.click(screen.getByRole("button", { name: /^Repository/ }));
    const sortRegion = region(container, "sorting");
    expect(sortRegion.querySelector("[data-selected-on-page]")?.textContent).toContain(firstId);
    fireEvent.click(within(sortRegion).getByText("re-sort identical data"));
    expect(sortRegion.querySelector("[data-moved]")?.getAttribute("data-moved")).toBe("0");
  });

  it("pagination: an insert repeats a row across an offset boundary and none across a keyset one", () => {
    const { container } = mount();
    settle();
    const footer = region(container, "pagination");
    const repeats = () => footer.querySelector("[data-repeats]")?.getAttribute("data-repeats");
    fireEvent.click(within(footer).getByText("insert a repository"));
    fireEvent.click(within(region(container, "loading-and-empty-states")).getByText("refresh"));
    settle();
    fireEvent.click(within(footer).getByRole("button", { name: "2" }));
    expect(repeats()).toBe("1");
    expect(footer.querySelector("[data-count]")?.getAttribute("data-count")).toContain("of 51 in the fleet");
    fireEvent.click(within(region(container, "client-server-split")).getByRole("button", { name: "all-server" }));
    settle();
    fireEvent.click(within(footer).getByText("insert a repository"));
    fireEvent.click(within(footer).getByLabelText("Next page"));
    settle();
    expect(repeats()).toBe("0");
    expect(footer.textContent).toContain("keyset");
  });

  it("performance: one selection toggle renders exactly one row", () => {
    const { container } = mount();
    settle();
    const log = container.querySelector("[data-render-log]");
    fireEvent.click(within(container.querySelectorAll("[data-id]")[3] as HTMLElement).getByRole("checkbox"));
    expect(log?.textContent).toBe("1");
    expect(container.querySelector("[data-rung]")?.getAttribute("data-rung")).toBe("3");
  });

  it("carries a real source excerpt and prose for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length).toBeGreaterThan(40);
    }
  });
});
