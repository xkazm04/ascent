// @vitest-environment jsdom
//
// The toasts-notifications scene under jsdom: it mounts inside the frame's MotionScope; every technique
// the body declares has exactly one `[data-technique]` region; the reduced path renders the same
// regions with the clock started paused; every volume mounts; the fiction line shows; and the
// mechanisms hold on screen — the live regions exist empty before any news and an arrival never moves
// the caret, focus within a toast pauses its dwell, acting on a toast clears the ledger's badge, and
// the fake clock commits an undo window. The store's own policy is pinned in desk.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { SURFACE_VOLUMES, surfaceRecord } from "@/lib/org/surface-catalog";
import { applySpotlight, regionSlugs } from "../surfaceSpotlight";
import { MotionScope } from "../surfaceMotionScope";
import { UNDO_WINDOW_MS } from "./fixtures";
import { body } from "./index";

const { Scene, techniques } = body;
const mount = (reduced: boolean, volume: (typeof SURFACE_VOLUMES)[number] = SURFACE_VOLUMES[0]) =>
  render(
    <MotionScope reduced={reduced}>
      <Scene technique={null} reduced={reduced} volume={volume} />
    </MotionScope>,
  );
const region = (c: HTMLElement, slug: string) => c.querySelector(`[data-technique="${slug}"]`) as HTMLElement;
// The fire buttons live in the queue region; the same labels appear in the escalation matrix.
const fire = (c: HTMLElement, label: string) => fireEvent.click(within(region(c, "queue-discipline")).getByText(label));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("toasts-notifications scene", () => {
  it("declares every technique of its catalog record as a region, once, and says its data is fiction", () => {
    const { container } = mount(false);
    const record = surfaceRecord("toasts-notifications");
    expect(record).toBeTruthy();
    const regions = regionSlugs(container);
    for (const t of techniques) expect(regions.filter((s) => s === t.slug), `region for ${t.slug}`).toHaveLength(1);
    expect(regions).toHaveLength(techniques.length);
    expect(techniques.map((t) => t.slug).sort()).toEqual([...(record?.techniqueSlugs ?? [])].sort());
    expect(screen.getByText(/fixture data/i)).toBeTruthy();
  });

  it("renders at every volume, and under reduced motion with the clock started paused", () => {
    for (const v of SURFACE_VOLUMES) {
      const { container, unmount } = mount(false, v);
      expect(container.querySelectorAll("[data-technique]")).toHaveLength(techniques.length);
      expect(container.querySelectorAll("[data-repo]").length).toBeGreaterThan(0);
      unmount();
    }
    const { container } = mount(true);
    expect(container.querySelector("[data-scene]")?.getAttribute("data-reduced")).toBe("true");
    expect(container.querySelector("[data-clock]")?.getAttribute("data-clock")).toBe("paused");
    fireEvent.click(screen.getByLabelText("Run the clock"));
    expect(container.querySelector("[data-clock]")?.getAttribute("data-clock")).toBe("running");
  });

  it("is spotlit by the frame's helper", () => {
    const { container } = mount(false);
    applySpotlight(container, "queue-discipline");
    expect(region(container, "queue-discipline").getAttribute("data-spotlit")).toBe("true");
    expect(region(container, "severity-taxonomy").classList.contains("opacity-40")).toBe(true);
  });

  it("live regions exist empty before the news, an arrival never moves the caret, and the drain voices one at a time", () => {
    const { container } = mount(false);
    const polite = container.querySelector('[data-live="polite"]') as HTMLElement;
    expect(polite.textContent).toBe("");
    expect(container.querySelector('[data-live="assertive"]')?.textContent).toBe("");
    const caret = container.querySelector("[data-caret]") as HTMLInputElement;
    caret.focus();
    fire(container, "credits low");
    fire(container, "critical");
    expect(document.activeElement).toBe(caret);
    expect(container.querySelector("[data-drain-queue]")?.getAttribute("data-drain-queue")).toBe("2");
    fireEvent.click(screen.getByLabelText("Voice the next utterance"));
    expect(container.querySelector('[data-live="assertive"]')?.textContent).toMatch(/engine unreachable/); // assertive jumped the queue
    expect(polite.textContent).toBe("");
    expect(container.querySelector("[data-drain-queue]")?.getAttribute("data-drain-queue")).toBe("1");
  });

  it("focus within a toast pauses its dwell; Escape dismisses it and returns focus", () => {
    const { container } = mount(false);
    const caret = container.querySelector("[data-caret]") as HTMLInputElement;
    caret.focus();
    fire(container, "scan finished");
    const card = container.querySelector("[data-toast]") as HTMLElement;
    const dismissBtn = within(card).getByLabelText(/^Dismiss:/);
    dismissBtn.focus();
    fireEvent.focus(dismissBtn); // jsdom's focus() does not reach React's onFocus (focusin) on its own
    expect(card.getAttribute("data-attended")).toBe("true");
    act(() => vi.advanceTimersByTime(10_000));
    expect(container.querySelector("[data-depth]")?.getAttribute("data-depth")).toBe("1"); // the clock did not run under attention
    fireEvent.keyDown(card, { key: "Escape" });
    expect(container.querySelector("[data-depth]")?.getAttribute("data-depth")).toBe("0"); // (the exit animation may still be playing)
    expect(document.activeElement).toBe(caret); // dismissal returned focus to where the user was
  });

  it("the badge derives from the rows and acting on the toast clears the twin in the center", () => {
    const { container } = mount(false);
    fire(container, "credits low");
    expect(container.querySelector("[data-badge]")?.getAttribute("data-badge")).toBe("1");
    expect(container.querySelector("[data-badge]")?.getAttribute("data-predicate")).toBe("unread");
    fireEvent.click(screen.getByLabelText(/^Notification center/));
    expect(container.querySelector("[data-center]")).toBeTruthy();
    expect(container.querySelector("[data-badge]")?.getAttribute("data-badge")).toBe("1"); // opening marks nothing read
    fireEvent.click(within(container.querySelector("[data-toast]") as HTMLElement).getByLabelText(/^Top up:/));
    expect(container.querySelector("[data-entry]")?.getAttribute("data-resolved")).toBe("true");
    expect(container.querySelector("[data-badge]")?.getAttribute("data-badge")).toBe("0");
    expect(container.querySelector("[data-depth]")?.getAttribute("data-depth")).toBe("0"); // the twin toast retracted
  });

  it("the undo window commits on expiry under the real clock", () => {
    const { container } = mount(false);
    const first = container.querySelector("[data-repo]") as HTMLElement;
    fireEvent.click(within(first).getByLabelText(/^Unwatch /));
    expect(first.getAttribute("data-status")).toBe("pending-removal");
    expect(container.querySelector("[data-undo]")?.getAttribute("data-undo")).toBe("live");
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS + 300));
    expect((container.querySelector("[data-repo]") as HTMLElement).getAttribute("data-status")).toBe("removed");
  });

  it("carries a real source excerpt and prose for every technique", () => {
    for (const t of techniques) {
      expect(t.mechanism.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
      expect(t.source.trim().length).toBeGreaterThan(40);
    }
  });
});
