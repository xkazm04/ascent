import { describe, expect, it } from "vitest";
import { computeLayout } from "./geometry";

describe("computeLayout", () => {
  it("scales the 1600x1000 design frame and centres it", () => {
    const l = computeLayout(1920, 1080, 9);
    expect(l.mobile).toBe(false);
    expect(l.geometry.U).toBeCloseTo(1.08, 9); // limited by height: 1080/1000
    expect(l.cssU).toBe(`${1.08 * 16}px`);
    expect(l.geometry.rays).toHaveLength(9);
    expect(l.labels).toHaveLength(9);
    expect(l.annIn).not.toBeNull();
    // rays fan downward, in dimension order, ending on one vertical rail
    const ys = l.geometry.rays.map((r) => r.E[1]);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(new Set(l.geometry.rays.map((r) => Math.round(r.E[0]))).size).toBe(1);
    // the incoming beam runs off the bottom edge
    expect(l.geometry.S[1]).toBe(1080 + 40);
  });

  it("switches to the phone frame at 760px and drops the desktop-only pieces", () => {
    const l = computeLayout(390, 844, 9);
    expect(l.mobile).toBe(true);
    expect(l.cssU).toBeNull();
    expect(l.labels).toEqual([]);
    expect(l.annOut).toBeNull();
    expect(computeLayout(761, 900, 9).mobile).toBe(false);
    expect(computeLayout(760, 900, 9).mobile).toBe(true);
  });
});
