// @vitest-environment jsdom
//
// G6-01 (wall vs panel type scale) and G6-07 (the strip's settled live region).
//
// These assert BEHAVIOUR, not attribute presence: what the region actually says, and — the part
// that makes it usable rather than a nuisance — when it stays SILENT. During a 40-repo fleet scan
// the four tiles tween on every landed result; a naive `aria-live` on them queues ~40 utterances
// that are still reading after the run ends, and competes with the header's progress count for the
// same polite channel.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { HeadlineStrip } from "@/components/org/intelligence/live/LiveWarRoomStat";
import { HEADLINE_SCALE } from "@/components/org/intelligence/live/warRoomScale";

// Pin prefers-reduced-motion so useTween settles synchronously — the tween is not what's under test.
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const S = (over: Partial<Parameters<typeof HeadlineStrip>[0]["stats"]> = {}) => ({
  avgOverall: 62,
  avgAdoption: 58,
  avgRigor: 66,
  aiNative: 12,
  scored: 38,
  total: 40,
  ...over,
});

const region = (c: HTMLElement) => c.querySelector('[aria-live="polite"]');

describe("HeadlineStrip live region (G6-07)", () => {
  it("exposes exactly ONE polite region for the whole strip, and it starts silent", () => {
    const { container } = render(<HeadlineStrip stats={S()} />);
    const politeAll = container.querySelectorAll('[aria-live="polite"]');
    expect(politeAll).toHaveLength(1);
    // A page load must not speak: the region is seeded empty, so mounting announces nothing.
    expect(politeAll[0]!.textContent).toBe("");
    expect(politeAll[0]).toHaveAttribute("aria-atomic", "true");
    // Nothing is announced by the individual tiles.
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("stays SILENT while a scan is running, no matter how many results land", () => {
    const { container, rerender } = render(<HeadlineStrip stats={S({ avgOverall: 50 })} running />);
    // 40 landed repos, each nudging the averages — the flood case.
    for (let i = 0; i < 40; i++) {
      rerender(<HeadlineStrip stats={S({ avgOverall: 50 + i, aiNative: i })} running />);
      act(() => void vi.advanceTimersByTime(5000));
    }
    expect(region(container)!.textContent).toBe("");
  });

  it("speaks ONCE, after the run settles, with the whole fleet standing", () => {
    const { container, rerender } = render(<HeadlineStrip stats={S({ avgOverall: 50, aiNative: 2 })} running />);
    rerender(<HeadlineStrip stats={S({ avgOverall: 62, aiNative: 12 })} running />);
    act(() => void vi.advanceTimersByTime(5000));
    expect(region(container)!.textContent).toBe("");

    // Scan ends.
    rerender(<HeadlineStrip stats={S({ avgOverall: 62, aiNative: 12 })} deltas={{ overall: 4, adoption: 3, rigor: -1 }} />);
    // Debounced — nothing yet.
    act(() => void vi.advanceTimersByTime(500));
    expect(region(container)!.textContent).toBe("");

    act(() => void vi.advanceTimersByTime(1000));
    expect(region(container)).toHaveTextContent(
      "Fleet headline metrics: org maturity 62, up 4; AI adoption 58, up 3; engineering rigor 66, down 1; " +
        "12 of 38 scored repos AI-Native. Changes since campaign kickoff.",
    );
  });

  it("coalesces a burst of settled changes into a single final utterance", () => {
    const { container, rerender } = render(<HeadlineStrip stats={S({ avgOverall: 60 })} />);
    for (const v of [61, 62, 63, 64]) {
      rerender(<HeadlineStrip stats={S({ avgOverall: v })} />);
      act(() => void vi.advanceTimersByTime(300)); // each change re-arms the debounce
    }
    expect(region(container)!.textContent).toBe("");
    act(() => void vi.advanceTimersByTime(1500));
    // Only the final standing is spoken — not 60, 61, 62, 63.
    expect(region(container)).toHaveTextContent(/org maturity 64/);
    expect(region(container)).not.toHaveTextContent(/61|62|63/);
  });

  it("does not repeat itself when a refresh brings back identical numbers", () => {
    const { container, rerender } = render(<HeadlineStrip stats={S({ avgOverall: 60 })} />);
    rerender(<HeadlineStrip stats={S({ avgOverall: 64 })} />);
    act(() => void vi.advanceTimersByTime(2000));
    const first = region(container)!.textContent;
    expect(first).toMatch(/org maturity 64/);

    // A kiosk poll re-renders with the same values — the region's text must not change (an
    // unchanged live region is not re-announced).
    rerender(<HeadlineStrip stats={S({ avgOverall: 64 })} />);
    act(() => void vi.advanceTimersByTime(5000));
    expect(region(container)!.textContent).toBe(first);
  });
});

describe("HeadlineStrip type scale (G6-01)", () => {
  it("defaults to the panel scale — the laptop dashboard is unchanged", () => {
    const { container } = render(<HeadlineStrip stats={S()} />);
    const value = container.querySelector(".tabular-nums")!;
    expect(value.className).toContain(HEADLINE_SCALE.panel.value);
    expect(container.querySelector(".uppercase")!.className).toContain(HEADLINE_SCALE.panel.label);
  });

  it("takes a materially larger scale on a declared wall — numbers AND labels", () => {
    const { container } = render(<HeadlineStrip stats={S()} scale="wall" />);
    const value = container.querySelector(".tabular-nums")!;
    expect(value.className).toContain(HEADLINE_SCALE.wall.value);
    expect(value.className).not.toContain("text-3xl");
    // The labels are the real legibility failure at 4m, so they must step up too — a bigger numeral
    // over a 14px label is still unreadable from across a room.
    const label = container.querySelector(".uppercase")!;
    expect(label.className).toContain(HEADLINE_SCALE.wall.label);
    expect(label.className).not.toContain("text-sm");
  });

  it("keeps the wall hero figure at or above the 48px hero floor at every breakpoint", () => {
    // text-5xl = 48px (base), sm:text-6xl = 60px, xl:text-7xl = 72px.
    expect(HEADLINE_SCALE.wall.value).toBe("text-5xl sm:text-6xl xl:text-7xl");
  });

  it("scales the sparkline box with the mode instead of leaving a laptop-sized chart on the wall", () => {
    const trend = [
      { date: "2026-07-01", avg: 50 },
      { date: "2026-07-02", avg: 62 },
    ];
    const { container } = render(<HeadlineStrip stats={S()} trend={trend} scale="wall" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe(String(HEADLINE_SCALE.wall.spark.w));
    expect(svg.getAttribute("height")).toBe(String(HEADLINE_SCALE.wall.spark.h));
    // Identity still comes from the label + aria-label, never from the line's color alone.
    expect(svg.getAttribute("aria-label")).toMatch(/Fleet average over the last 2 scan days: 50 to 62/);
  });
});
