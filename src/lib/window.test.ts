// The org dashboard window does double duty: it bounds the trend AND fixes the period-over-period
// baseline date. Pin that preset starts snap to a stable LOCAL-MIDNIGHT day boundary (not a raw
// wall-clock ms offset that flickers within a day / drifts across DST) and the period cookie round-trips.

import { describe, it, expect } from "vitest";
import { resolveWindow, parsePeriodCookie, serializePeriodCookie } from "./window";

const NOW = new Date(2026, 5, 16, 14, 37, 22, 500); // local 2026-06-16 14:37:22.500 (a mid-afternoon instant)
const atLocalMidnight = (d: Date | null) =>
  d !== null && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;

describe("resolveWindow — preset starts snap to local midnight", () => {
  it("30d start is a local-midnight day boundary, not a raw ms offset from now", () => {
    const w = resolveWindow({ range: "30d" }, NOW);
    expect(w.key).toBe("30d");
    expect(atLocalMidnight(w.start)).toBe(true);
  });

  it("90d start is a local-midnight day boundary", () => {
    expect(atLocalMidnight(resolveWindow({ range: "90d" }, NOW).start)).toBe(true);
  });

  it("quarter + custom starts are local midnight too (consistent reference frame)", () => {
    expect(atLocalMidnight(resolveWindow({ range: "quarter" }, NOW).start)).toBe(true);
    expect(atLocalMidnight(resolveWindow({ range: "custom", from: "2026-01-01" }, NOW).start)).toBe(true);
  });

  it("all-time has no baseline; an unknown range falls back to the 90d default", () => {
    expect(resolveWindow({ range: "all" }, NOW).start).toBeNull();
    expect(resolveWindow({ range: "bogus" }, NOW).key).toBe("90d");
  });
});

describe("period cookie round-trip", () => {
  it("round-trips a preset range", () => {
    expect(parsePeriodCookie(serializePeriodCookie({ range: "30d" }))?.range).toBe("30d");
  });

  it("round-trips a custom range with its from/to", () => {
    const parsed = parsePeriodCookie(serializePeriodCookie({ range: "custom", from: "2026-01-01", to: "2026-03-31" }));
    expect(parsed).toMatchObject({ range: "custom", from: "2026-01-01", to: "2026-03-31" });
  });

  it("rejects an empty / unknown cookie", () => {
    expect(parsePeriodCookie(undefined)).toBeNull();
    expect(parsePeriodCookie("nonsense")).toBeNull();
  });
});
