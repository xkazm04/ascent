import { describe, expect, it } from "vitest";
import { cellName, cursorAfterRowsChange, moveCursor, readoutText, resolveCursor } from "./matrixCursorModel";
import { STATE_HINT } from "./states";

const AXES = ["Declared", "Observed", "Enforced"];
const IDS = ["a", "b"];

describe("moveCursor: arrows inside, edges stop, Home/End jump", () => {
  it("steps right, stops at the last axis (no wrap), steps down, and jumps with Home/End", () => {
    expect(moveCursor({ rowId: "a", axis: "Declared" }, "ArrowRight", IDS, AXES)).toEqual({ rowId: "a", axis: "Observed" });
    expect(moveCursor({ rowId: "a", axis: "Enforced" }, "ArrowRight", IDS, AXES)).toEqual({ rowId: "a", axis: "Enforced" });
    expect(moveCursor({ rowId: "a", axis: "Declared" }, "ArrowDown", IDS, AXES)).toEqual({ rowId: "b", axis: "Declared" });
    expect(moveCursor({ rowId: "a", axis: "Observed" }, "Home", IDS, AXES)).toEqual({ rowId: "a", axis: "Declared" });
    expect(moveCursor({ rowId: "a", axis: "Observed" }, "End", IDS, AXES)).toEqual({ rowId: "a", axis: "Enforced" });
  });

  it("stops at the grid's top, bottom and left edges too", () => {
    expect(moveCursor({ rowId: "a", axis: "Observed" }, "ArrowUp", IDS, AXES)).toEqual({ rowId: "a", axis: "Observed" });
    expect(moveCursor({ rowId: "b", axis: "Observed" }, "ArrowDown", IDS, AXES)).toEqual({ rowId: "b", axis: "Observed" });
    expect(moveCursor({ rowId: "b", axis: "Declared" }, "ArrowLeft", IDS, AXES)).toEqual({ rowId: "b", axis: "Declared" });
  });

  it("Ctrl+Home / Ctrl+End jump to the first and last cell of the whole grid", () => {
    expect(moveCursor({ rowId: "b", axis: "Observed" }, "Home", IDS, AXES, { ctrl: true })).toEqual({ rowId: "a", axis: "Declared" });
    expect(moveCursor({ rowId: "a", axis: "Observed" }, "End", IDS, AXES, { ctrl: true })).toEqual({ rowId: "b", axis: "Enforced" });
  });

  it("returns null for a key it does not own, so the caller leaves the event alone", () => {
    expect(moveCursor({ rowId: "a", axis: "Declared" }, "Tab", IDS, AXES)).toBeNull();
    expect(moveCursor({ rowId: "a", axis: "Declared" }, "x", IDS, AXES)).toBeNull();
  });
});

describe("cursorAfterRowsChange: the position is keyed by identity, not slot", () => {
  it("falls to the nearest surviving neighbour, never whatever now sits in slot 2", () => {
    expect(cursorAfterRowsChange({ rowId: "b", axis: "Observed" }, ["a", "b", "c"], ["a", "c"])).toEqual({ rowId: "c", axis: "Observed" });
  });

  it("follows its row when the rows resort", () => {
    expect(cursorAfterRowsChange({ rowId: "b", axis: "Enforced" }, ["a", "b", "c"], ["c", "b", "a"])).toEqual({ rowId: "b", axis: "Enforced" });
  });

  it("falls back to the neighbour before it when every later row is gone", () => {
    expect(cursorAfterRowsChange({ rowId: "c", axis: "Declared" }, ["a", "b", "c"], ["a", "b"])).toEqual({ rowId: "b", axis: "Declared" });
  });

  it("is null when no row survives", () => {
    expect(cursorAfterRowsChange({ rowId: "a", axis: "Declared" }, ["a"], [])).toBeNull();
  });
});

describe("resolveCursor: always a real cell, or null for an empty grid", () => {
  it("defaults to the first cell and repairs an axis that is no longer drawn", () => {
    expect(resolveCursor(null, [], IDS, AXES)).toEqual({ rowId: "a", axis: "Declared" });
    expect(resolveCursor({ rowId: "b", axis: "Gone" }, IDS, IDS, AXES)).toEqual({ rowId: "b", axis: "Declared" });
    expect(resolveCursor(null, [], [], AXES)).toBeNull();
  });
});

describe("readoutText: rendersValue governs the readout exactly as it governs the cell", () => {
  it("reads a hatched cell as Not judged plus its caveat, with no numeral", () => {
    const text = readoutText("acme/api", "Enforced", { state: "not-judged", score: 0 });
    expect(text).toBe(`acme/api · Enforced: Not judged. ${STATE_HINT["not-judged"]}`);
    expect(text).not.toMatch(/\d/);
  });

  it("prints the value of a measured cell, a measured 0 included", () => {
    expect(readoutText("acme/api", "Observed", { state: "measured", score: 62 })).toBe(`acme/api · Observed: Measured 62. ${STATE_HINT.measured}`);
    expect(cellName("acme/api", "Observed", { state: "measured", score: 0 })).toBe("acme/api · Observed: Measured 0");
  });

  it("names a void as an absence and never a zero", () => {
    expect(cellName("acme/cli", "Enforced", { state: "missing", score: 0 })).toBe("acme/cli · Enforced: No measurement");
  });
});
