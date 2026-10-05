// The freshness STATE machine: four tiers plus an orthogonal drift flag, every branch total over
// null and garbled input. The thresholds are inputs (the caller reads scanMaxCacheAgeMs() on the
// server and threads the window down), so this module stays client-safe and the window is never
// re-typed next to the pipeline's own.

import { describe, it, expect } from "vitest";

import { reportFreshnessState, shortSha, freshnessWindowLabel } from "./reportFreshness";

const WEEK = 7 * 86_400_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-03-01T12:00:00.000Z");

/** An ISO timestamp `ms` before NOW. */
function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("reportFreshnessState — a recent reading on the scored commit is current and silent", () => {
  it("returns tier current with no reason and no drift clause", () => {
    const state = reportFreshnessState({
      scannedAt: ago(10 * 60_000),
      scoredSha: "abc1234",
      lastSeenHead: "abc1234",
      windowMs: WEEK,
      now: NOW,
    });
    expect(state.tier).toBe("current");
    expect(state.drifted).toBe(false);
    expect(state.reason).toBe("");
    expect(state.driftNote).toBe("");
    expect(state.ageMs).toBe(10 * 60_000);
  });

  it("stays current when the window is unknown (the live-scan path threads no window)", () => {
    const state = reportFreshnessState({ scannedAt: ago(30 * DAY), now: NOW });
    expect(state.tier).toBe("current");
    expect(state.reason).toBe("");
    expect(state.windowMs).toBeNull();
  });

  it("stays current when the age gate is disabled (windowMs 0)", () => {
    const state = reportFreshnessState({ scannedAt: ago(90 * DAY), windowMs: 0, now: NOW });
    expect(state.tier).toBe("current");
    expect(state.reason).toBe("");
  });
});

describe("reportFreshnessState — past the belief window it is stale, and says why", () => {
  it("returns tier stale with the reason naming the window the product re-scans on", () => {
    const state = reportFreshnessState({ scannedAt: ago(8 * DAY), windowMs: WEEK, now: NOW });
    expect(state.tier).toBe("stale");
    expect(state.reason).toContain("7-day");
    expect(state.reason).toMatch(/re-scans on/i);
    expect(state.reason).not.toContain("—");
  });

  it("derives the threshold AND the label from the window it is handed, never a re-typed 7", () => {
    // A 1-day window makes a 2-day-old reading stale; the same reading is current under a week.
    const tight = reportFreshnessState({ scannedAt: ago(2 * DAY), windowMs: DAY, now: NOW });
    expect(tight.tier).toBe("stale");
    expect(tight.reason).toContain("1-day");
    expect(tight.reason).not.toContain("7-day");
    expect(reportFreshnessState({ scannedAt: ago(2 * DAY), windowMs: WEEK, now: NOW }).tier).not.toBe("stale");
  });

  it("names the halfway point as aging rather than silently reading as current", () => {
    const state = reportFreshnessState({ scannedAt: ago(5 * DAY), windowMs: WEEK, now: NOW });
    expect(state.tier).toBe("aging");
    expect(state.reason).toContain("7-day");
    expect(state.reason).not.toBe("");
  });
});

describe("reportFreshnessState — drift is orthogonal to age and worded as LAST SEEN", () => {
  it("flags drift on a minutes-old reading whose scored sha is not the head last seen", () => {
    const state = reportFreshnessState({
      scannedAt: ago(60_000),
      scoredSha: "abc1234",
      lastSeenHead: "def5678",
      windowMs: WEEK,
      now: NOW,
    });
    expect(state.tier).toBe("current");
    expect(state.drifted).toBe(true);
    expect(state.scoredSha).toBe("abc1234");
    expect(state.lastSeenHead).toBe("def5678");
    expect(state.driftNote).toMatch(/last seen/i);
    expect(state.driftNote).not.toMatch(/\bcurrent head\b/i);
  });

  it("matches a full sha against its abbreviation instead of crying drift", () => {
    const state = reportFreshnessState({
      scannedAt: ago(60_000),
      scoredSha: "abc1234",
      lastSeenHead: "ABC1234ffffffffffffffffffffffffffffffff",
      windowMs: WEEK,
      now: NOW,
    });
    expect(state.drifted).toBe(false);
    expect(state.driftNote).toBe("");
  });

  it("suppresses the clause when the hint was never recorded, or equals the scored sha", () => {
    const never = reportFreshnessState({ scannedAt: ago(60_000), scoredSha: "abc1234", lastSeenHead: null, windowMs: WEEK, now: NOW });
    expect(never.drifted).toBe(false);
    expect(never.driftNote).toBe("");

    const same = reportFreshnessState({ scannedAt: ago(60_000), scoredSha: "abc1234", lastSeenHead: "abc1234", windowMs: WEEK, now: NOW });
    expect(same.drifted).toBe(false);

    const noScored = reportFreshnessState({ scannedAt: ago(60_000), scoredSha: undefined, lastSeenHead: "def5678", windowMs: WEEK, now: NOW });
    expect(noScored.drifted).toBe(false);
  });
});

describe("reportFreshnessState — an unreadable scan date is unknown, never current", () => {
  it("returns tier unknown with a stated scan-date-not-recorded reason for a missing date", () => {
    const state = reportFreshnessState({ scannedAt: undefined, windowMs: WEEK, now: NOW });
    expect(state.tier).toBe("unknown");
    expect(state.ageMs).toBeNull();
    expect(state.reason).toMatch(/no recorded scan date/i);
  });

  it("returns tier unknown for a garbled date", () => {
    const state = reportFreshnessState({ scannedAt: "not-a-date", windowMs: WEEK, now: NOW });
    expect(state.tier).toBe("unknown");
    expect(state.reason).toMatch(/no recorded scan date/i);
  });

  it("clamps a future scan date to zero age rather than reporting a negative one", () => {
    const state = reportFreshnessState({ scannedAt: new Date(NOW + 60_000).toISOString(), windowMs: WEEK, now: NOW });
    expect(state.tier).toBe("current");
    expect(state.ageMs).toBe(0);
  });
});

describe("freshness helpers", () => {
  it("shortSha abbreviates to 7 and returns null for absent input", () => {
    expect(shortSha("abc1234def5678")).toBe("abc1234");
    expect(shortSha("  ")).toBeNull();
    expect(shortSha(null)).toBeNull();
    expect(shortSha(undefined)).toBeNull();
  });

  it("freshnessWindowLabel reads whole days, and falls back to hours", () => {
    expect(freshnessWindowLabel(WEEK)).toBe("7-day");
    expect(freshnessWindowLabel(DAY)).toBe("1-day");
    expect(freshnessWindowLabel(6 * 3_600_000)).toBe("6-hour");
  });
});
