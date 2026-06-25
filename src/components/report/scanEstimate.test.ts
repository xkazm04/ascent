import { describe, expect, it } from "vitest";
import {
  SCAN_ESTIMATE_MS,
  SCAN_ESTIMATE_LONG_MS,
  SCAN_CLIENT_TIMEOUT_MS,
  expectationCopy,
  formatDuration,
  timeProgressPct,
} from "./scanEstimate";

describe("timeProgressPct", () => {
  it("is 0 at the start and strictly increasing over time", () => {
    expect(timeProgressPct(0)).toBe(0);
    let prev = -1;
    for (let t = 0; t <= SCAN_ESTIMATE_LONG_MS; t += 5_000) {
      const p = timeProgressPct(t);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("never reaches 100 (so the bar only completes when the scan actually does)", () => {
    expect(timeProgressPct(SCAN_ESTIMATE_MS)).toBeLessThan(95);
    expect(timeProgressPct(SCAN_ESTIMATE_LONG_MS)).toBeLessThan(100);
    expect(timeProgressPct(60 * 60_000)).toBeLessThan(100);
  });

  it("approaches ~90% near the typical estimate", () => {
    expect(timeProgressPct(SCAN_ESTIMATE_MS)).toBeGreaterThan(85);
  });
});

describe("formatDuration", () => {
  it("formats m:ss and clamps negatives to 0:00", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9_000)).toBe("0:09");
    expect(formatDuration(75_000)).toBe("1:15");
    expect(formatDuration(305_000)).toBe("5:05");
    expect(formatDuration(-500)).toBe("0:00");
  });
});

describe("expectationCopy", () => {
  it("escalates honestly across the three time bands", () => {
    const early = expectationCopy(10_000);
    const mid = expectationCopy(SCAN_ESTIMATE_MS + 1);
    const late = expectationCopy(SCAN_ESTIMATE_LONG_MS + 1);
    expect(early).toMatch(/few minutes/i);
    expect(mid).toMatch(/almost there/i);
    expect(late).toMatch(/longer than usual/i);
    expect(new Set([early, mid, late]).size).toBe(3);
  });
});

describe("timeout coherence", () => {
  it("keeps the client backstop above the long-scan estimate", () => {
    expect(SCAN_CLIENT_TIMEOUT_MS).toBeGreaterThan(SCAN_ESTIMATE_LONG_MS);
  });
});
