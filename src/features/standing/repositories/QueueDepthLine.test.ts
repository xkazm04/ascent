// UAT `VICTOR-L1-07`. `queueDepth()` reached only the two cron routes' JSON, so a director budgeting a
// weekly paid cadence would see 400 per-row "queued" tags before he saw the number 400.
//
// The pure half is what is pinned here: the aggregate-honesty rule (a queue that could not be read is
// never printed as zero) has no other guard, and it is the half that would silently regress.

import { describe, expect, it } from "vitest";
import { queueAge, queueDepthSentence } from "./QueueDepthLine";

const lanes = (rescore: number, probe: number, oldestMs: number | null = null) => ({
  rescore: { queued: rescore, oldestAgeMs: rescore ? oldestMs : null },
  probe: { queued: probe, oldestAgeMs: probe ? oldestMs : null },
});

describe("queueDepthSentence", () => {
  it("answers the one-number question with the oldest job's age", () => {
    expect(queueDepthSentence(lanes(400, 0, 3 * 3_600_000))).toBe(
      "Scan queue: 400 rescans waiting, oldest queued 3h ago.",
    );
  });

  it("names both lanes when both are backed up, and dates the queue off the OLDEST of them", () => {
    const d = lanes(2, 5);
    d.rescore.oldestAgeMs = 90 * 60_000;
    d.probe.oldestAgeMs = 20 * 60_000;
    expect(queueDepthSentence(d)).toBe("Scan queue: 2 rescans · 5 probes waiting, oldest queued 2h ago.");
  });

  it("REFUSES to print a zero it did not measure", () => {
    // The whole point: an unreadable queue and an empty one are different facts and must not share a
    // sentence. `orgQueueDepth` returns null for both no-database and a failed read.
    expect(queueDepthSentence(null)).toContain("unavailable");
    expect(queueDepthSentence(null)).not.toContain("nothing waiting");
  });

  it("states an empty queue as the measurement it is", () => {
    expect(queueDepthSentence(lanes(0, 0))).toContain("nothing waiting");
  });

  it("says so when a counted queue could not be dated, rather than dropping the age silently", () => {
    expect(queueDepthSentence(lanes(3, 0, null))).toBe("Scan queue: 3 rescans waiting (age unavailable).");
  });

  it("uses the singular for one job in a lane", () => {
    expect(queueDepthSentence(lanes(1, 1, 45_000))).toBe("Scan queue: 1 rescan · 1 probe waiting, oldest queued 45s ago.");
  });
});

describe("queueAge", () => {
  it("climbs to the coarsest honest unit", () => {
    expect(queueAge(20_000)).toBe("20s");
    expect(queueAge(45 * 60_000)).toBe("45m");
    expect(queueAge(3 * 3_600_000)).toBe("3h");
    expect(queueAge(5 * 24 * 3_600_000)).toBe("5d");
  });

  it("clamps a negative age rather than printing one", () => {
    expect(queueAge(-1000)).toBe("0s");
  });
});
