// @vitest-environment jsdom
//
// First tests for the dashboard tour engine. The tour/ directory shipped with ZERO coverage while
// carrying the four behaviors a guided tour lives or dies on: the step cursor, cross-page redirection,
// skipping a step this org can't anchor, and session persistence of where the user got to.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { TourStep } from "./types";
import { tourStorageKey } from "./tourStorage";

const nav = vi.hoisted(() => ({ pathname: "/org/acme", push: vi.fn<(href: string) => void>() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));

import { ANCHOR_POLL_FRAMES, useTourEngine } from "./useTourEngine";

const STEPS: TourStep[] = [
  { id: "a", chapter: "scope", page: "", anchor: "alpha", kicker: "Scope · 1", title: "Step A", body: "a" },
  { id: "b", chapter: "results", page: "", anchor: "beta", kicker: "Results · 1", title: "Step B", body: "b" },
  { id: "c", chapter: "modules", page: "repositories", anchor: "gamma", kicker: "Modules · 1", title: "Step C", body: "c" },
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

function mount(enabled: boolean, slug = "acme") {
  const onExit = vi.fn();
  const hook = renderHook(() => useTourEngine(slug, STEPS, { enabled, onExit }));
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

describe("useTourEngine — cross-page redirection", () => {
  it("pushes the step's page when the cursor moves off the current one, and never while collapsed", () => {
    const { result, rerender } = mount(true);
    expect(nav.push).not.toHaveBeenCalled(); // step A already lives on the overview

    act(() => result.current.goTo(2)); // step C lives on /repositories
    expect(nav.push).toHaveBeenCalledWith("/org/acme/repositories");

    // Once the navigation lands, the engine stops pushing.
    nav.pathname = "/org/acme/repositories";
    nav.push.mockReset();
    rerender();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("stays inert while the drawer is closed", () => {
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
    // Step C sits on another page, so the cursor lands there and waits for the redirect rather than
    // spinning on a dead step.
    expect(result.current.index).toBe(2);
    expect(nav.push).toHaveBeenCalledWith("/org/acme/repositories");
  });
});

describe("useTourEngine — session persistence", () => {
  it("round-trips the cursor + open state across a remount, keyed per org", () => {
    const first = mount(true);
    act(() => first.result.current.next());
    expect(first.result.current.index).toBe(1);

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

  it("records the collapsed state so a refresh doesn't reopen a drawer the user shut", () => {
    const { result, unmount } = mount(false);
    act(() => result.current.goTo(2));
    expect(JSON.parse(sessionStorage.getItem(tourStorageKey("acme"))!)).toEqual({ open: false, index: 2 });
    unmount();
  });
});
