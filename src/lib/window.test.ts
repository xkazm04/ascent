// The org dashboard window does double duty: it bounds the trend AND fixes the period-over-period
// baseline date. Pin that preset starts snap to a stable LOCAL-MIDNIGHT day boundary (not a raw
// wall-clock ms offset that flickers within a day / drifts across DST) and the period cookie round-trips.

import { describe, it, expect } from "vitest";
import { resolveWindow, parsePeriodCookie, serializePeriodCookie, DEFAULT_RANGE } from "./window";

const DAY = 86_400_000;

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

// ── Deeper boundary-date pins (test-mastery-2026-06-18, org-overview-standing #2) ───────────────
// The above proves the start is *a* midnight; these pin which *exact* instant, the documented
// half-open `to`-inclusive boundary, render-hour independence, and the malformed-input fallthroughs
// — the precise regressions the module comments warn about (a reverted midnight snap, an off-by-one
// in the cookie validation that accepts an unknown range and silently widens every user's window).

describe("resolveWindow — exact rolling-window start value", () => {
  it("90d start equals local midnight of (now − 90d), not the 14:37 render instant", () => {
    const w = resolveWindow({ range: "90d" }, NOW);
    const raw = new Date(NOW.getTime() - 90 * DAY);
    const expected = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
    expect(w.start!.getTime()).toBe(expected.getTime());
    expect(w.end).toBeNull(); // open-ended (now)
  });

  it("30d start equals local midnight of (now − 30d)", () => {
    const raw = new Date(NOW.getTime() - 30 * DAY);
    const expected = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
    expect(resolveWindow({ range: "30d" }, NOW).start!.getTime()).toBe(expected.getTime());
  });

  it("quarter start is the first day of the calendar quarter (June ⇒ Apr 1) at local midnight", () => {
    expect(resolveWindow({ range: "quarter" }, NOW).start!.getTime()).toBe(new Date(2026, 3, 1).getTime());
  });

  it("most same-day renders collapse to one baseline (noon == night), and the start is always a midnight", () => {
    // The midnight snap removes the WITHIN-day flicker a raw ms-instant baseline had: a noon render and
    // a one-second-before-midnight render on the same calendar day resolve to the identical start.
    const noon = resolveWindow({ range: "90d" }, new Date(2026, 5, 16, 12, 0, 0));
    const night = resolveWindow({ range: "90d" }, new Date(2026, 5, 16, 23, 59, 59));
    expect(noon.start!.getTime()).toBe(night.start!.getTime());
    expect(atLocalMidnight(noon.start)).toBe(true);
  });

  it("KNOWN DST EDGE: when the 90d lookback straddles a DST transition, a very-early render can still shift the baseline one calendar day — pinned as current behavior", () => {
    // The snap fixes intra-day flicker but NOT the residual DST seam: `startOfDay(now − 90*DAY)` subtracts
    // a flat 90×86.4M ms, so when the lookback crosses a spring-forward boundary the resulting wall-clock
    // can land just before vs just after local midnight depending on the render hour, snapping to adjacent
    // days. This asserts the actual behavior (so it is a deliberate, test-breaking change to "fix"), and is
    // tz-dependent — only meaningful where the lookback crosses a transition; elsewhere both renders agree.
    const early = resolveWindow({ range: "90d" }, new Date(2026, 5, 16, 0, 0, 1)).start!.getTime();
    const night = resolveWindow({ range: "90d" }, new Date(2026, 5, 16, 23, 59, 59)).start!.getTime();
    const gapDays = Math.round((night - early) / DAY);
    // 0 in a no-DST tz (e.g. UTC runner); 1 across a spring-forward seam (e.g. CET→CEST). Never > 1.
    expect([0, 1]).toContain(gapDays);
    // Whatever the seam does, BOTH ends remain clean local midnights — the snap invariant holds.
    expect(atLocalMidnight(new Date(early))).toBe(true);
    expect(atLocalMidnight(new Date(night))).toBe(true);
  });

  it("unknown / missing range both fall back to DEFAULT_RANGE (90d)", () => {
    expect(resolveWindow({ range: "bogus" }, NOW).key).toBe(DEFAULT_RANGE);
    expect(resolveWindow({}, NOW).key).toBe(DEFAULT_RANGE);
  });

  it("reads the first value of an array-shaped param (Next searchParams)", () => {
    expect(resolveWindow({ range: ["quarter", "30d"] }, NOW).key).toBe("quarter");
  });
});

describe("resolveWindow — custom half-open boundary (to is inclusive of its whole day)", () => {
  it("`to` end is local-midnight(to) + DAY − 1ms, so a scan anywhere on the to-day counts", () => {
    const w = resolveWindow({ range: "custom", from: "2026-01-01", to: "2026-03-31" }, NOW);
    expect(w.start!.getTime()).toBe(new Date("2026-01-01T00:00:00").getTime());
    const toMidnight = new Date("2026-03-31T00:00:00").getTime();
    expect(w.end!.getTime()).toBe(toMidnight + DAY - 1); // 23:59:59.999, half-open boundary pinned
    expect(w.from).toBe("2026-01-01");
    expect(w.to).toBe("2026-03-31");
  });

  it("custom with no `to` is open-ended (end null); a blank/invalid `from` ⇒ null start, no comparison", () => {
    const open = resolveWindow({ range: "custom", from: "2026-01-01" }, NOW);
    expect(open.end).toBeNull();
    expect(open.comparisonLabel).toBe("vs range start");

    const bad = resolveWindow({ range: "custom", from: "not-a-date" }, NOW);
    expect(bad.start).toBeNull();
    expect(bad.comparisonLabel).toBe("");
  });
});

describe("parsePeriodCookie — malformed-input fallthrough and round-trip into resolveWindow", () => {
  it("preset round-trip yields explicit undefined from/to", () => {
    expect(parsePeriodCookie(serializePeriodCookie({ range: "30d" }))).toEqual({
      range: "30d",
      from: undefined,
      to: undefined,
    });
  });

  it("custom round-trip drives resolveWindow to the same inclusive-to window", () => {
    const cookie = serializePeriodCookie({ range: "custom", from: "2026-01-01", to: "2026-03-31" });
    const w = resolveWindow(parsePeriodCookie(cookie)!, NOW);
    expect(w.key).toBe("custom");
    expect(w.end!.getTime()).toBe(new Date("2026-03-31T00:00:00").getTime() + DAY - 1);
  });

  it("empty custom parts normalize to undefined (not empty strings)", () => {
    expect(parsePeriodCookie("custom||")).toEqual({ range: "custom", from: undefined, to: undefined });
  });

  it("an unknown range key — even with extra pipe parts — returns null (no silent widen/reset)", () => {
    expect(parsePeriodCookie("180d|foo|bar")).toBeNull();
    expect(parsePeriodCookie("|2026-01-01|2026-03-31")).toBeNull(); // missing range key
    expect(parsePeriodCookie("")).toBeNull();
  });
});
