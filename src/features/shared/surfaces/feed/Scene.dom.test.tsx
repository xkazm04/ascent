// @vitest-environment jsdom
//
// The feed scene under jsdom: it mounts inside the frame's MotionScope; every technique the body
// declares has exactly one `[data-technique]` region; every volume renders; the reduced path renders
// the same regions with entrances settled; the fiction line shows; and the mechanisms hold — arrivals
// prepend at the head and are held while reading, the tuple comparator survives a shuffled refetch
// where the timestamp-only one does not, a late arrival counts as unseen, mark-all-read is idempotent
// and the frozen divider survives the heartbeat, clusters fold a burst, and paging past the horizon
// yields a truncation marker rather than an empty page.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord } from "@/lib/org/surface-catalog";
import { applySpotlight, regionSlugs } from "../surfaceSpotlight";
import { MotionScope } from "../surfaceMotionScope";
import { body } from "./index";

const { Scene, techniques } = body;
const mount = (reduced: boolean, volume: (typeof SURFACE_VOLUMES)[number] = SURFACE_VOLUMES[1]) =>
  render(
    <MotionScope reduced={reduced}>
      <Scene technique={null} reduced={reduced} volume={volume} />
    </MotionScope>,
  );
const region = (c: HTMLElement, slug: string) => c.querySelector(`[data-technique="${slug}"]`) as HTMLElement;
const attr = (c: HTMLElement, sel: string, name: string) => c.querySelector(sel)?.getAttribute(name);
const firstRow = (c: HTMLElement) => attr(c, "[data-row], [data-cluster]", "data-row") ?? attr(c, "[data-row], [data-cluster]", "data-cluster");

describe("feed scene", () => {
  it("declares every technique of its catalog record as a region, once, and says its data is fiction", () => {
    const { container } = mount(false);
    const record = surfaceRecord("feed");
    expect(record).toBeTruthy();
    const regions = regionSlugs(container);
    for (const t of techniques) expect(regions.filter((x) => x === t.slug), `region for ${t.slug}`).toHaveLength(1);
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
    expect(screen.getByText(/fixture data/i)).toBeTruthy();
  });

  it("renders at every volume and under reduced motion with entrances settled", () => {
    for (const v of SURFACE_VOLUMES) {
      const { container, unmount } = mount(false, v);
      expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
      expect(container.querySelectorAll("[data-row], [data-cluster]").length).toBeGreaterThan(0);
      unmount();
    }
    const { container } = mount(true);
    expect(attr(container, "[data-scene]", "data-reduced")).toBe("true");
    expect(container.querySelectorAll('[data-entered="now"]')).toHaveLength(0);
    applySpotlight(container, "feed-retention");
    expect(region(container, "feed-retention").getAttribute("data-spotlit")).toBe("true");
    expect(region(container, "live-prepend").classList.contains("opacity-40")).toBe(true);
  });

  it("live-prepend: at the head an arrival renders in place; scrolled away it is held until the jump", () => {
    const { container } = mount(false);
    const feed = region(container, "live-prepend");
    const before = firstRow(container);
    fireEvent.click(within(feed).getByText("arrive ×1"));
    expect(firstRow(container)).not.toBe(before);
    const viewport = feed.querySelector('[role="log"]') as HTMLElement;
    Object.defineProperty(viewport, "scrollTop", { value: 200, configurable: true, writable: true });
    fireEvent.scroll(viewport);
    expect(attr(feed, "[data-mode]", "data-mode")).toBe("reading");
    const head = firstRow(container);
    fireEvent.click(within(feed).getByText("burst ×12"));
    expect(firstRow(container)).toBe(head); // the viewport did not move
    expect(attr(feed, "[data-new-pill]", "data-new-pill")).toBe("12");
    fireEvent.click(within(feed).getByText(/jump to latest/));
    expect(feed.querySelector("[data-new-pill]")).toBeNull();
    expect(attr(feed, "[data-mode]", "data-mode")).toBe("following");
    // A dropped connection: a failed catch-up is said; a cursor walk drops the replayed boundary row.
    fireEvent.click(within(feed).getByText("drop connection"));
    fireEvent.click(within(feed).getByText("reconnect · catch-up fails"));
    expect(feed.querySelector('[data-seam="missed"]')).toBeTruthy();
    fireEvent.click(within(feed).getByText("drop connection"));
    fireEvent.click(within(feed).getByText("arrive ×1"));
    fireEvent.click(within(feed).getByText("reconnect · catch-up"));
    expect(within(feed).getByText(/2 fetched · 1 duplicate dropped/)).toBeTruthy();
  });

  it("chronology: the tuple comparator survives a shuffled refetch; timestamp-only swaps tied rows", () => {
    const { container } = mount(false);
    const chrono = region(container, "reverse-chronology-semantics");
    fireEvent.click(within(chrono).getByText(/sync burst ×12/));
    fireEvent.click(within(chrono).getByRole("button", { name: /refetch/ }));
    expect(attr(chrono, "[data-swaps]", "data-swaps")).toBe("0");
    fireEvent.click(within(chrono).getByText("ts desc only"));
    fireEvent.click(within(chrono).getByRole("button", { name: /refetch/ }));
    expect(Number(attr(chrono, "[data-swaps]", "data-swaps"))).toBeGreaterThan(0);
    // The optimistic note waits outside the ranked list until the server assigns its key.
    fireEvent.click(within(chrono).getByText(/post a note/));
    expect(container.querySelector("[data-pending]")).toBeTruthy();
    fireEvent.click(screen.getByText("server confirms"));
    expect(container.querySelector("[data-pending]")).toBeNull();
  });

  it("read position: a late arrival counts as unseen; mark-all-read is one idempotent write; the frozen divider survives the heartbeat", () => {
    const { container } = mount(false);
    const read = region(container, "read-position-and-unseen");
    const chrono = region(container, "reverse-chronology-semantics");
    const unseen = () => Number(attr(read, "[data-badge]", "data-badge"));
    const start = unseen();
    expect(start).toBeGreaterThan(0);
    fireEvent.click(within(chrono).getByText(/late arrival/));
    expect(unseen()).toBe(start + 1); // below the head, above the anchor: still unseen
    fireEvent.click(within(read).getByText("mark all read"));
    expect(unseen()).toBe(0);
    expect(attr(read, "[data-writes]", "data-writes")).toBe("1");
    fireEvent.click(within(read).getByText("mark all read"));
    expect(attr(read, "[data-writes]", "data-writes")).toBe("1"); // anchor already at head: no write
    fireEvent.click(within(read).getByText("heartbeat"));
    expect(Number(attr(read, "[data-since-entry]", "data-since-entry"))).toBe(start + 1); // the delta is computed against the snapshot
    expect(container.querySelector('[data-divider="since-last-look"]')).toBeTruthy();
    fireEvent.click(within(read).getByText("security only"));
    expect(within(read).getByText(/unseen · security only/)).toBeTruthy(); // the badge carries its predicate
  });

  it("clustering: a burst folds into one row that grows in place, and the flat log shows every occurrence", () => {
    const { container } = mount(false);
    const cluster = region(container, "event-clustering");
    const chrono = region(container, "reverse-chronology-semantics");
    fireEvent.click(within(chrono).getByText(/sync burst ×12/));
    const first = container.querySelector("[data-cluster]") as HTMLElement;
    expect(first.getAttribute("data-members")).toBe("12");
    const id = first.getAttribute("data-cluster");
    fireEvent.click(within(first).getByRole("button", { expanded: false }));
    fireEvent.click(within(cluster).getByText(/extend the newest sync run/));
    const grown = container.querySelector("[data-cluster]") as HTMLElement;
    expect(grown.getAttribute("data-cluster")).toBe(id); // identity is the oldest member
    expect(grown.getAttribute("data-members")).toBe("13");
    expect(grown.getAttribute("data-open")).toBe("true"); // expansion survives growth
    const rendered = Number(attr(cluster, "[data-rendered]", "data-rendered"));
    fireEvent.click(within(cluster).getByText("flat log"));
    expect(Number(attr(cluster, "[data-rendered]", "data-rendered"))).toBeGreaterThan(rendered);
  });

  it("retention: the reaper runs on insert, paging past the horizon yields a truncation marker, and a forfeited anchor is said", () => {
    const { container } = mount(false, SURFACE_VOLUMES[0]);
    const ret = region(container, "feed-retention");
    const feed = region(container, "live-prepend");
    expect(Number(attr(ret, "[data-reaped]", "data-reaped"))).toBeGreaterThan(0);
    expect(container.querySelector('[data-settled="false"]')).toBeTruthy(); // the running scan survived
    fireEvent.click(within(feed).getByText("older"));
    expect(attr(ret, "[data-page]", "data-page")).toBe("truncated");
    expect(attr(feed, "[data-edge]", "data-edge")).toBe("truncated");
    fireEvent.click(within(ret).getByText("7 days"));
    expect(Number(attr(ret, "[data-forfeited]", "data-forfeited"))).toBeGreaterThan(0);
  });

  it("carries a real source excerpt and prose for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length).toBeGreaterThan(40);
    }
  });
});
