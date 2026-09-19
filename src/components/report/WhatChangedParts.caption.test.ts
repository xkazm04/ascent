// Pins ambiguity-ui-scan-2026-07-16 trends-comparison #4: the compare picker's <option> labels must
// be UNIQUE. The headline caption (score · level · timeAgo · engine) rendered two same-day scans with
// the same score as byte-identical options, so targeting a specific scan degraded to guesswork. The
// list variant uses an absolute date+time, appends the short sha when recorded, and ordinal-suffixes
// any remaining exact collisions.

import { describe, it, expect } from "vitest";
import { scanOptionCaptions } from "./WhatChangedParts";

function point(over: Partial<Parameters<typeof scanOptionCaptions>[0][number]> & { id: string }) {
  return {
    overallScore: 62,
    level: "L3",
    scannedAt: "2026-07-14T09:12:00.000Z",
    engineProvider: "bedrock",
    headSha: null,
    ...over,
  };
}

describe("scanOptionCaptions (trends-comparison 07-16 #4)", () => {
  it("distinguishes same-day scans with identical score/level/engine via sha and timestamp", () => {
    const scans = [
      point({ id: "new", scannedAt: "2026-07-14T15:30:00.000Z", headSha: "a1b2c3d4e5" }),
      point({ id: "old", scannedAt: "2026-07-14T09:12:00.000Z", headSha: "f6e5d4c3b2" }),
    ];
    const captions = scanOptionCaptions(scans, "new");

    expect(captions.get("new")).not.toBe(captions.get("old"));
    expect(captions.get("new")).toContain("a1b2c3d"); // short sha, 7 chars
    expect(captions.get("old")).toContain("f6e5d4c");
    expect(captions.get("new")).toContain("latest"); // latest flag preserved from the old caption
    expect(captions.get("old")).not.toContain("latest");
    // Absolute short date, not a widening "x days ago" bucket.
    expect(captions.get("new")).toMatch(/Jul 1[45]/); // day may shift with the runner's timezone
  });

  it("ordinal-suffixes captions that are STILL byte-identical (same minute, no sha)", () => {
    const scans = [point({ id: "a" }), point({ id: "b" }), point({ id: "c", scannedAt: "2026-07-01T01:01:00.000Z" })];
    const captions = scanOptionCaptions(scans, undefined);

    expect(captions.get("a")).not.toBe(captions.get("b"));
    expect(captions.get("a")).toMatch(/· #1$/);
    expect(captions.get("b")).toMatch(/· #2$/);
    // A unique caption gets no ordinal noise.
    expect(captions.get("c")).not.toMatch(/· #\d+$/);
    // Every caption in the map is unique — the guarantee the picker relies on.
    const all = [...captions.values()];
    expect(new Set(all).size).toBe(all.length);
  });
});
