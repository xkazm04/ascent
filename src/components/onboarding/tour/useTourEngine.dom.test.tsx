// @vitest-environment jsdom
//
// Tests for the dashboard tour engine. The tour/ directory shipped with ZERO coverage while carrying
// the four behaviors a guided tour lives or dies on: the step cursor, cross-surface deep-linking,
// skipping a step this org can't anchor, and session persistence of where the user got to.
//
// W6c changed three parts of the contract, pinned below: steps address a TAB (not a sub-path), the
// engine persists only the cursor (the drawer owns `open`), and auto-advancing over a dead step is
// opt-out — the task drawer turns it off so a missing control never silently changes which task the
// member is looking at.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { TourStep } from "./types";
import { tourStorageKey, writeTourState } from "./tourStorage";

const nav = vi.hoisted(() => ({ pathname: "/org/acme", search: "", push: vi.fn<(href: string) => void>() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));

import { ANCHOR_POLL_FRAMES, useTourEngine } from "./useTourEngine";

const STEPS: TourStep[] = [
  { id: "a", tab: "overview", anchor: "alpha", kicker: "Scope · 1", title: "Step A", body: "a" },
  { id: "b", tab: "overview", anchor: "beta", kicker: "Results · 1", title: "Step B", body: "b" },
  { id: "c", tab: "repositories", anchor: "gamma", kicker: "Modules · 1", title: "Step C", body: "c" },
];

// Deterministic rAF: the engine polls for its anchor on animation frames, so the tests drive those frames
// by hand instead of racing jsdom's timer-backed implementation.
let frames: FrameRequestCallback[] = [];
function flushFrames(n: number) {
  for (let i = 0; i < n; i++) {
    const due = frames;
    frames = [];
    if (due.length === 0) return;
    for (const cb of due) cb(performance.now());
  }
}

beforeEach(() => {
  nav.pathname = "/org/acme";
  nav.search = "";
  nav.push.mockReset();
  frames = [];
  sessionStorage.clear();
  document.body.innerHTML = "";
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // jsdom has no layout engine — the engine calls scrollIntoView on a resolved anchor.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function anchor(name: string) {
  const el = document.createElement("div");
  el.setAttribute("data-tour", name);
  document.body.appendChild(el);
  return el;
}

function mount(enabled: boolean, slug = "acme", autoAdvanceOverSkipped = true) {
  const onExit = vi.fn();
  const hook = renderHook(() => useTourEngine(slug, STEPS, { enabled, onExit, autoAdvanceOverSkipped }));
  return { ...hook, onExit };
}

describe("useTourEngine — cursor", () => {
  it("advances, retreats, jumps, and clamps at both ends", () => {
    const { result } = mount(false);
    expect(result.current.index).toBe(0);
    expect(result.current.atFirst).toBe(true);
    expect(result.current.total).toBe(3);

    act(() => result.current.next());
    expect(result.current.index).toBe(1);

    act(() => result.current.prev());
    act(() => result.current.prev()); // clamped at the first step
    expect(result.current.index).toBe(0);

    act(() => result.current.goTo(2));
    expect(result.current.index).toBe(2);
    expect(result.current.atLast).toBe(true);

    act(() => result.current.next()); // clamped at the last step
    expect(result.current.index).toBe(2);

    act(() => result.current.goTo(99));
    expect(result.current.index).toBe(2);
  });
});

describe("useTourEngine — cross-tab deep linking", () => {
  it("pushes the step's TAB href when the cursor moves off the current one", () => {
    const { result, rerender } = mount(true);
    expect(nav.push).not.toHaveBeenCalled(); // step A already lives on the overview tab

    act(() => result.current.goTo(2)); // step C lives on the repositories tab
    expect(nav.push).toHaveBeenCalledWith("/org/acme?tab=repositories");

    // Once the navigation lands, the engine stops pushing — settled on `?tab=`, not on a sub-path that
    // a permanent redirect would immediately rewrite.
    nav.search = "tab=repositories";
    nav.push.mockReset();
    rerender();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("treats a legacy sub-path as being on the step's tab", () => {
    nav.pathname = "/org/acme/repositories";
    const { result } = mount(true);
    act(() => result.current.goTo(2));
    // Already on the repositories surface (reached by the permanent redirect stub), so no further push.
    expect(nav.push).not.toHaveBeenCalledWith("/org/acme?tab=repositories");
  });

  it("stays inert while no spotlight is running", () => {
    const { result } = mount(false);
    act(() => result.current.goTo(2));
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("useTourEngine — a step this org can't anchor", () => {
  it("skips past it once the anchor poll budget runs out, and marks it unavailable", () => {
    anchor("beta"); // step B's target exists; step A's ("alpha") never mounts on this org
    const { result } = mount(true);

    expect(result.current.index).toBe(0);
    expect(result.current.seeking).toBe(true);

    act(() => flushFrames(ANCHOR_POLL_FRAMES + 2));

    expect(result.current.isSkipped("a")).toBe(true);
    expect(result.current.index).toBe(1); // stepped over, in the forward direction of travel
    expect(result.current.seeking).toBe(true); // now hunting step B's anchor

    act(() => flushFrames(2));
    expect(result.current.rect).not.toBeNull();
    expect(result.current.seeking).toBe(false);
    expect(result.current.isSkipped("b")).toBe(false);
  });

  it("stops seeking and holds position when nothing live remains ahead", () => {
    // No anchors at all on this dashboard: the last step has nowhere to advance to.
    const { result } = mount(true);
    act(() => result.current.goTo(1));
    act(() => flushFrames(ANCHOR_POLL_FRAMES + 2));
    expect(result.current.isSkipped("b")).toBe(true);
    // Step C sits on another tab, so the cursor lands there and waits for the deep link rather than
    // spinning on a dead step.
    expect(result.current.index).toBe(2);
    expect(nav.push).toHaveBeenCalledWith("/org/acme?tab=repositories");
  });

  it("holds the cursor on a dead step when auto-advance is off (the task drawer)", () => {
    anchor("beta");
    const { result } = mount(true, "acme", false);
    act(() => flushFrames(ANCHOR_POLL_FRAMES + 2));
    // The member asked for step A specifically; a missing control degrades to plain navigation, it does
    // not answer a different question by sliding to step B.
    expect(result.current.isSkipped("a")).toBe(true);
    expect(result.current.index).toBe(0);
    expect(result.current.seeking).toBe(false);
    expect(result.current.rect).toBeNull();
  });
});

describe("useTourEngine — session persistence", () => {
  it("round-trips the cursor across a remount, keyed per org, without touching the drawer's `open`", () => {
    writeTourState("acme", { open: true, index: 0 }); // the drawer's field, written by the drawer
    const first = mount(true);
    act(() => first.result.current.next());
    expect(first.result.current.index).toBe(1);

    // The engine patches ONLY `index` — `open` survives because the drawer owns it.
    expect(JSON.parse(sessionStorage.getItem(tourStorageKey("acme"))!)).toEqual({ open: true, index: 1 });
    expect(sessionStorage.getItem(tourStorageKey("beta"))).toBeNull();

    first.unmount();

    // A hard refresh: a brand-new engine for the same org resumes on the same step...
    const resumed = mount(true);
    expect(resumed.result.current.index).toBe(1);
    resumed.unmount();

    // ...while a DIFFERENT org starts clean rather than inheriting acme's cursor.
    const other = mount(true, "beta");
    expect(other.result.current.index).toBe(0);
  });

  it("persists the cursor even while no spotlight runs", () => {
    const { result, unmount } = mount(false);
    act(() => result.current.goTo(2));
    expect(JSON.parse(sessionStorage.getItem(tourStorageKey("acme"))!)).toEqual({ open: false, index: 2 });
    unmount();
  });
});
