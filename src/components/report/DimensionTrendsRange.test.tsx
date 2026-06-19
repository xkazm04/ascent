import { describe, it, expect, vi, afterEach } from "vitest";
import { withinRange } from "@/components/report/DimensionTrendsRange";
import type { HistoryPoint } from "@/lib/db/scans";

// Pins the range-toggle window slice (trends-comparison test-mastery #5, Low). `withinRange` is the
// pure pre-filter every 5d/30d/90d/All chart maps over, and the header's "N scans shown" count is
// derived from it. Two non-obvious contracts are pinned here because a refactor could silently flip
// either with no other test catching it:
//   1. BOUNDARY: a scan whose timestamp is exactly at the cutoff is KEPT (the predicate is `t >= cutoff`,
//      inclusive). Only points STRICTLY older than the window are dropped.
//   2. NaN KEEP-RULE: a scan whose `scannedAt` is unparseable (Date.parse → NaN) is KEPT, not dropped
//      (DimensionTrendsRange.tsx:20 — `Number.isNaN(t) ? true : t >= cutoff`). Filtering unplaceable
//      dates is `parseRepositoryHistory`'s job upstream, never this window slice's.
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

  it("BOUNDARY: a scan exactly at the cutoff is KEPT (predicate is `t >= cutoff`, inclusive)", () => {
    pinNow();
    const atCutoff = pt(iso(NOW - 5 * DAY), "atCutoff"); // exactly 5d ago === cutoff
    const justOlder = pt(iso(NOW - 5 * DAY - 1), "justOlder"); // 1ms past the cutoff
    const result = withinRange([atCutoff, justOlder], 5);
    // The cutoff point survives; the one strictly older (by 1ms) is dropped.
    expect(result.map((s) => s.id)).toEqual(["atCutoff"]);
  });

  it("NaN KEEP-RULE: a scan with an unparseable `scannedAt` is KEPT (never silently filtered here)", () => {
    pinNow();
    const garbage = pt("garbage", "garbage"); // Date.parse → NaN
    const empty = pt("", "empty"); // Date.parse("") → NaN
    const old = pt(iso(NOW - 90 * DAY), "old"); // far outside the 5d window
    const result = withinRange([garbage, empty, old], 5);
    // Both NaN-date points survive even though the window is tiny; only the placeable-but-old one drops.
    expect(result.map((s) => s.id)).toEqual(["garbage", "empty"]);
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
