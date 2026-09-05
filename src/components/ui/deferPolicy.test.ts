import { describe, expect, it } from "vitest";
import {
  DEFER_IDLE_TIMEOUT_MS,
  DEFER_VISIBLE_ROOT_MARGIN,
  mountsImmediately,
  QUIET_PLACEHOLDER_DELAY_MS,
  type DeferStrategy,
} from "./deferPolicy";

const TIMED: DeferStrategy[] = ["next-frame", "idle"];

describe("mountsImmediately", () => {
  it("defers the timed strategies by default", () => {
    for (const strategy of TIMED) expect(mountsImmediately({ strategy })).toBe(false);
  });

  it("defers `visible` by default", () => {
    expect(mountsImmediately({ strategy: "visible" })).toBe(false);
  });

  it("collapses the timed strategies under reduced motion", () => {
    for (const strategy of TIMED) expect(mountsImmediately({ strategy, reducedMotion: true })).toBe(true);
  });

  // `visible` is a payload decision (don't build a chart nobody scrolls to), not a choreography one.
  it("does NOT collapse `visible` under reduced motion", () => {
    expect(mountsImmediately({ strategy: "visible", reducedMotion: true })).toBe(false);
  });

  it("`immediate` wins over every strategy, including `visible`", () => {
    for (const strategy of [...TIMED, "visible" as const]) {
      expect(mountsImmediately({ strategy, immediate: true })).toBe(true);
      expect(mountsImmediately({ strategy, immediate: true, reducedMotion: true })).toBe(true);
    }
  });
});

describe("timing constants", () => {
  // The delay is duplicated in CSS (`.reveal-quiet { animation-delay: 150ms }`); this pins the
  // number so a change here is a deliberate, paired edit.
  it("pins the quiet placeholder delay to the globals.css value", () => {
    expect(QUIET_PLACEHOLDER_DELAY_MS).toBe(150);
  });

  it("pins the idle safety net and the visible root margin", () => {
    expect(DEFER_IDLE_TIMEOUT_MS).toBe(500);
    expect(DEFER_VISIBLE_ROOT_MARGIN).toBe("240px");
  });
});
