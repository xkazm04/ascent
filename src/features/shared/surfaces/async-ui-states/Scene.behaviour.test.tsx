// @vitest-environment jsdom
//
// The behavioural half of the async-ui-states gate, on fake timers: no empty renders before the first
// response settles; a stale response is dropped by latest-wins; a window turn keeps and dims the rows
// while a new search drops them; the busy button submits once for two synchronous presses; a failed
// refresh keeps held rows and admits the failure; a failed first load is a failure, never an empty.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { SURFACE_VOLUMES } from "@/lib/org/surface-catalog";
import { LATENCY } from "./asyncState";
import { body } from "./index";

const { Scene } = body;
const mount = () => render(<Scene technique={null} reduced={false} volume={SURFACE_VOLUMES[0]} />);
const region = (root: HTMLElement, slug: string) => root.querySelector(`[data-technique="${slug}"]`) as HTMLElement;
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("async-ui-states behaviour", () => {
  it("never asserts empty before settling, and the no-match empty only after a response", () => {
    const { container } = mount();
    const list = region(container, "placeholder-design");
    expect(list.querySelector("[data-ghost]")).toBeTruthy();
    expect(list.querySelector("[data-empty]")).toBeNull();
    expect(region(container, "state-model").querySelector("[data-settled]")?.getAttribute("data-settled")).toBe("false");
    tick(LATENCY.slow + 1);
    expect(list.querySelectorAll("[data-id]").length).toBeGreaterThan(0);
    fireEvent.click(within(list).getByText("“zz”"));
    expect(list.querySelector("[data-empty]")).toBeNull(); // in flight again: ghost, not "nothing here"
    expect(list.querySelector("[data-ghost]")).toBeTruthy();
    tick(LATENCY.slow + 1);
    expect(list.querySelector("[data-empty]")?.getAttribute("data-empty")).toBe("no-match");
  });

  it("latest-wins: the slow stale response is dropped, the fast one applied", () => {
    const { container } = mount();
    tick(LATENCY.slow + 1);
    const ledger = region(container, "state-model");
    fireEvent.click(within(ledger).getByText("race: slow then fast"));
    tick(LATENCY.warm + 1);
    expect(ledger.querySelector("[data-dropped]")?.getAttribute("data-dropped")).toBe("0");
    tick(LATENCY.race);
    expect(ledger.querySelector("[data-dropped]")?.getAttribute("data-dropped")).toBe("1");
    expect(region(container, "placeholder-design").querySelectorAll("[data-id]").length).toBeGreaterThan(0);
  });

  it("a window turn keeps the rows (marked superseded); a new search drops them and resets the page", () => {
    const { container } = mount();
    tick(LATENCY.slow + 1);
    const list = region(container, "placeholder-design");
    const content = () => list.querySelector("[data-content]") as HTMLElement;
    fireEvent.click(within(list).getByLabelText("Next page"));
    expect(content().getAttribute("data-superseded")).toBe("true");
    expect(content().getAttribute("data-content")).toBe("superseded");
    expect(list.querySelectorAll("[data-id]").length).toBeGreaterThan(0);
    expect(region(container, "windowing-vs-identifying-keys").querySelector("[data-change-axis]")?.getAttribute("data-change-axis")).toBe("windowing");
    tick(LATENCY.slow + 1);
    expect(content().getAttribute("data-superseded")).toBe("false");
    expect(list.querySelector("[data-page]")?.getAttribute("data-page")).toBe("2");
    fireEvent.click(within(list).getByText("“al”"));
    expect(content().getAttribute("data-content")).toBe("loading");
    expect(list.querySelectorAll("[data-id]")).toHaveLength(0);
    expect(list.querySelector("[data-page]")?.getAttribute("data-page")).toBe("1");
    expect(region(container, "state-model").querySelector("[data-settled]")?.getAttribute("data-settled")).toBe("false");
  });

  it("the cascade plays on first arrival and not on a refresh", () => {
    const { container } = mount();
    tick(LATENCY.slow + 1);
    const list = region(container, "placeholder-design");
    expect(list.querySelectorAll('[data-entering="true"]').length).toBeGreaterThan(0);
    list.querySelectorAll('[data-entering="true"]').forEach((li) => fireEvent(li, new Event("animationend", { bubbles: true })));
    expect(list.querySelectorAll('[data-entering="true"]')).toHaveLength(0);
    fireEvent.click(within(region(container, "arrival-choreography")).getByText("poll"));
    tick(LATENCY.slow + 1);
    expect(list.querySelectorAll("[data-id]").length).toBeGreaterThan(0);
    expect(list.querySelectorAll('[data-entering="true"]')).toHaveLength(0);
    expect(region(container, "arrival-choreography").querySelector("[data-edge]")?.getAttribute("data-edge")).toBe("refresh");
  });

  it("the busy button disarms synchronously: two presses, one submission, aria-busy meanwhile", async () => {
    const { container } = mount();
    const queue = region(container, "action-busy-states");
    fireEvent.click(within(queue).getByText("scripted double-press on row 1"));
    const counter = () => queue.querySelector("[data-presses]") as HTMLElement;
    expect(counter().getAttribute("data-presses")).toBe("2");
    expect(counter().getAttribute("data-accepted")).toBe("1");
    const btn = queue.querySelector('[data-item="fu-1"] button') as HTMLButtonElement;
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.disabled).toBe(true);
    expect(queue.querySelector('[data-item="fu-2"] button')?.getAttribute("aria-busy")).toBe("false");
    // The operation starts in a microtask after the press; flush it, then let its timer fire.
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(LATENCY.slow + 1);
    });
    expect(queue.querySelector('[data-item="fu-1"]')?.getAttribute("data-approved")).toBe("true");
  });

  it("a failed refresh keeps held rows and admits it; a failed first load is a failure, not an empty", () => {
    const { container } = mount();
    tick(LATENCY.warm + 1);
    const alerts = region(container, "failure-states");
    expect(alerts.querySelectorAll("[data-rows] li").length).toBeGreaterThan(0);
    fireEvent.click(within(alerts).getByText("next request fails"));
    fireEvent.click(within(alerts).getByText("refresh"));
    tick(LATENCY.slow + 1);
    expect(alerts.querySelectorAll("[data-rows] li").length).toBeGreaterThan(0); // never destroyed
    expect(alerts.querySelector("[data-ambient-failure]")).toBeTruthy();
    expect(alerts.querySelector("[data-content]")?.getAttribute("data-content")).toBe("settled-data");
    fireEvent.click(within(alerts).getByText("reset region"));
    fireEvent.click(within(alerts).getByText("load"));
    tick(LATENCY.slow + 1);
    expect(alerts.querySelector("[data-failure]")?.getAttribute("data-failure")).toBe("unreachable");
    expect(alerts.querySelector("[data-empty]")).toBeNull();
    expect(alerts.querySelector("[data-reported]")?.getAttribute("data-reported")).toBe("2");
  });

  it("an empty is typed by the raw collection, and the world change re-ghosts before it settles", () => {
    const { container } = mount();
    tick(LATENCY.slow + 1);
    const empty = region(container, "empty-state-design");
    expect(empty.querySelector("[data-empty]")?.getAttribute("data-empty")).toBe("no-match");
    fireEvent.click(within(empty).getByText("nothing exists yet"));
    expect(empty.querySelector("[data-ghost]")).toBeTruthy();
    expect(empty.querySelector("[data-empty]")).toBeNull();
    tick(LATENCY.slow + 1);
    expect(empty.querySelector("[data-empty]")?.getAttribute("data-empty")).toBe("first-run");
  });
});
