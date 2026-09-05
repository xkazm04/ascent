import { describe, it, expect, vi, afterEach } from "vitest";
import { rangeCutoff, withinRange } from "@/components/report/DimensionTrendsRange";
import type { HistoryPoint } from "@/lib/db/scans";

// Pins the range-toggle window slice (trends-comparison test-mastery #5, Low). `withinRange` is the
// pure pre-filter every 5d/30d/90d/All chart maps over, and the header's "N scans shown" count is
// derived from it. Two non-obvious contracts are pinned here because a refactor could silently flip
// either with no other test catching it:
//   1. BOUNDARY: the window is CALENDAR days in the canonical org zone (`addDaysInZone`), half-open at
//      the bottom — a scan exactly at the cutoff midnight is KEPT, one 1ms older is dropped — and
//      UNBOUNDED at the top, so a clock-skewed future scan stays visible.
//   2. NaN RULE (by window): a scan whose `scannedAt` is unparseable (Date.parse → NaN) is DROPPED when
//      a finite `days` window is active — an undateable point has no place in a 5d/30d/90d range, so the
//      user must be able to narrow it out (DimensionTrendsRange.tsx — `Number.isNaN(t) ? false : ...`).
//      For the open `days === null` (All) view it is KEPT (identity passthrough below). (Previously the
//      slice kept NaN-date points in EVERY window, leaving a floating, unfilterable, blank-x-label dot.)
// Also pinned: `days === null` (All) is an identity passthrough, and newest-first input order is
// preserved (filter never reorders).

// Minimal HistoryPoint factory — only `scannedAt` is load-bearing for withinRange.
function pt(scannedAt: string, id = scannedAt): HistoryPoint {
  return {
    id,
    headSha: null,
    overallScore: 50,
    level: "B",
    levelName: "Building",
    confidence: 0.9,
    engineProvider: "test",
    scannedAt,
    dimensions: [],
  };
}

const NOW = Date.parse("2026-06-19T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("withinRange", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function pinNow() {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  }

  it("includes a scan inside the window and excludes one strictly older than it", () => {
    pinNow();
    const inside = pt(iso(NOW - 2 * DAY), "inside"); // 2d ago, within 5d
    const outside = pt(iso(NOW - 10 * DAY), "outside"); // 10d ago, outside 5d
    const result = withinRange([inside, outside], 5);
    expect(result.map((s) => s.id)).toEqual(["inside"]);
  });

  it("BOUNDARY: the window is CALENDAR days in the canonical zone, half-open [midnight, ∞)", () => {
    pinNow();
    // "5d" = today plus the four calendar days before it. With NOW = 2026-06-19 (UTC, the canonical
    // default zone) the cutoff is 2026-06-15T00:00:00Z — NOT `now − 5 × 86_400_000` (2026-06-14T12:00Z).
    // Calendar arithmetic via addDaysInZone is what keeps a DST day (23 or 25 hours) from sliding the
    // boundary into the neighbouring day. (Canonical time-zone policy, src/lib/org/timezone.ts.)
    const atMidnight = pt("2026-06-15T00:00:00.000Z", "atMidnight"); // exactly the cutoff → KEPT
    const justOlder = pt("2026-06-14T23:59:59.999Z", "justOlder"); // 1ms before it → DROPPED
    const result = withinRange([atMidnight, justOlder], 5);
    expect(result.map((s) => s.id)).toEqual(["atMidnight"]);
  });

  it("has NO upper bound — a clock-skewed future-dated scan is still shown, not filtered away", () => {
    pinNow();
    const future = pt(iso(NOW + 2 * DAY), "future");
    expect(withinRange([future], 5).map((s) => s.id)).toEqual(["future"]);
  });

  it("rangeCutoff returns the zoned midnight `days - 1` calendar days back", () => {
    expect(rangeCutoff(5, new Date(NOW)).toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(rangeCutoff(1, new Date(NOW)).toISOString()).toBe("2026-06-19T00:00:00.000Z"); // today only
    expect(rangeCutoff(30, new Date(NOW)).toISOString()).toBe("2026-05-21T00:00:00.000Z");
  });

  it("NaN RULE: with a finite window, an unparseable `scannedAt` is DROPPED (an undateable point has no place in a date range)", () => {
    pinNow();
    const garbage = pt("garbage", "garbage"); // Date.parse → NaN
    const empty = pt("", "empty"); // Date.parse("") → NaN
    const inside = pt(iso(NOW - 2 * DAY), "inside"); // within the 5d window
    const result = withinRange([garbage, empty, inside], 5);
    // The NaN-date points are excluded so the user can narrow them out; only the placeable, in-range one survives.
    expect(result.map((s) => s.id)).toEqual(["inside"]);
  });

  it("NaN RULE: with the open (All) view an unparseable `scannedAt` is KEPT (identity passthrough)", () => {
    pinNow();
    const garbage = pt("garbage", "garbage");
    const old = pt(iso(NOW - 1000 * DAY), "old");
    const result = withinRange([garbage, old], null);
    expect(result.map((s) => s.id)).toEqual(["garbage", "old"]);
  });

  it("OPEN RANGE: `days === null` (All) returns the input unchanged (identity passthrough)", () => {
    pinNow();
    const scans = [pt(iso(NOW), "a"), pt(iso(NOW - 1000 * DAY), "b"), pt("garbage", "c")];
    const result = withinRange(scans, null);
    expect(result).toBe(scans); // same reference — no copy, no filter
  });

  it("preserves newest-first input order of the surviving scans", () => {
    pinNow();
    const newest = pt(iso(NOW - 1 * DAY), "newest");
    const mid = pt(iso(NOW - 2 * DAY), "mid");
    const oldest = pt(iso(NOW - 3 * DAY), "oldest");
    const result = withinRange([newest, mid, oldest], 30);
    expect(result.map((s) => s.id)).toEqual(["newest", "mid", "oldest"]);
  });

  it("returns an empty array (not a throw) when every placeable scan is outside the window", () => {
    pinNow();
    const result = withinRange([pt(iso(NOW - 100 * DAY), "x"), pt(iso(NOW - 200 * DAY), "y")], 30);
    expect(result).toEqual([]);
  });

  it("handles an empty input list", () => {
    pinNow();
    expect(withinRange([], 5)).toEqual([]);
    expect(withinRange([], null)).toEqual([]);
  });
});
