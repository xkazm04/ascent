// G6-08 — the run progress bar must never exceed 100%.
//
// The failure mode is specific and reachable: a credit-truncated run. The server emits `notice`
// with the slice it can actually afford, which SHRINKS `progress.total` mid-scan, while `done`
// keeps counting against results already landed. The raw `done/total` ratio then goes above 1 and
// was rendered straight into `aria-valuenow` (an out-of-range progressbar, which some SRs read as
// a nonsense percentage) and into the bar's CSS `width` (a fill overrunning its rounded track on a
// projected wall — the most visible surface in the product).

import { describe, expect, it } from "vitest";
import { progressPct } from "@/features/inflight/live/liveWarRoomFold";

describe("progressPct — run progress is clamped to [0,100]", () => {
  it("computes the ordinary whole-percent case", () => {
    expect(progressPct(0, 40)).toBe(0);
    expect(progressPct(10, 40)).toBe(25);
    expect(progressPct(40, 40)).toBe(100);
  });

  it("rounds to whole percent (the bar and aria-valuenow take integers)", () => {
    expect(progressPct(1, 3)).toBe(33);
    expect(progressPct(2, 3)).toBe(67);
  });

  it("CLAMPS a credit-truncated run where `total` shrank below `done`", () => {
    // 30 repos already landed, then the notice rewrites the denominator to the 12 the balance covers.
    expect(progressPct(30, 12)).toBe(100);
    expect(progressPct(41, 40)).toBe(100);
  });

  it("floors a negative or zero denominator to 0 rather than emitting Infinity/NaN", () => {
    expect(progressPct(5, 0)).toBe(0);
    expect(progressPct(5, -1)).toBe(0);
    expect(progressPct(-5, 40)).toBe(0);
  });

  it("floors non-finite input to 0 (malformed or absent SSE totals)", () => {
    expect(progressPct(Number.NaN, 40)).toBe(0);
    expect(progressPct(5, Number.NaN)).toBe(0);
    expect(progressPct(Number.POSITIVE_INFINITY, 40)).toBe(0);
    expect(progressPct(5, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
