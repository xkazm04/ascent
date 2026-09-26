import { describe, expect, it } from "vitest";
import { seenThrough } from "./seen-through";

const NOW = new Date("2026-09-26T12:00:00.000Z");

describe("seenThrough", () => {
  it("stamps what the view was evaluated through, not the clock at acknowledgment", () => {
    expect(seenThrough("2026-09-26T09:00:00.000Z", NOW).toISOString()).toBe("2026-09-26T09:00:00.000Z");
  });

  it("clamps a future through to now", () => {
    expect(seenThrough("2026-09-27T00:00:00.000Z", NOW)).toBe(NOW);
  });

  it("falls back to now when through is missing or unreadable (an older client)", () => {
    expect(seenThrough(undefined, NOW)).toBe(NOW);
    expect(seenThrough(42, NOW)).toBe(NOW);
    expect(seenThrough("not a date", NOW)).toBe(NOW);
  });

  it("A/B: movement that arrives between the load and the look stays unseen", () => {
    // The ledger loads at 09:00 in a background tab; a run finishes at 10:30; the viewer brings the tab
    // forward at 12:00 and the stamp fires. The next visit counts what finished after the anchor.
    const loadedAt = "2026-09-26T09:00:00.000Z";
    const finishedWhileHidden = Date.parse("2026-09-26T10:30:00.000Z");
    const unseenNextVisit = (anchor: Date) => (finishedWhileHidden > anchor.getTime() ? 1 : 0);

    // A - the clock at acknowledgment: the run was never on screen and is gone from the next briefing.
    expect(unseenNextVisit(NOW)).toBe(0);
    // B - through the load: the run is still news next time.
    expect(unseenNextVisit(seenThrough(loadedAt, NOW))).toBe(1);
  });
});
