// Pins the trend pair model (trends-1): every timeline move carries its baseline scan, the pair
// becomes one compare URL with chronological roles, and a pair that is not two real scans is refused.

import { describe, expect, it } from "vitest";
import {
  EMPTY_PICK,
  isCompactedId,
  pairCompareHref,
  pickReducer,
  pickedPair,
  type PickState,
} from "@/app/trends/trendPairModel";
import { deriveTrendAnnotations } from "@/app/trends/annotations";
import { deriveDeployAnnotations } from "@/app/trends/deployAnnotations";
import { historyReturnPath } from "@/lib/history/repoHistoryAccess";
import { COMPACTED_POINT_ID_PREFIX, isCompactedPointId } from "@/lib/db/scans-read";
import type { HistoryPoint } from "@/lib/db/scans";

function pt(id: string, day: number, overallScore: number, level = "L3", headSha: string | null = null): HistoryPoint {
  return {
    id,
    headSha,
    overallScore,
    level,
    levelName: `Level ${level}`,
    confidence: 0.9,
    engineProvider: "test",
    engineModel: "test",
    rubricVersion: null,
    scannedAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  };
}

describe("annotation markers carry their baseline", () => {
  it("a promotion marker carries the older scan as prevScanId", () => {
    const anns = deriveTrendAnnotations([pt("s3", 3, 80, "L3"), pt("s2", 2, 60, "L2"), pt("s1", 1, 60, "L2")]);
    const promo = anns.find((a) => a.kind === "promotion");
    expect(promo?.scanId).toBe("s3");
    expect(promo?.prevScanId).toBe("s2");
  });

  it("a marker whose predecessor is a compacted point carries prevScanId null", () => {
    const digest = { ...pt("digest:2026-08", 1, 70, "L3"), compacted: true };
    const anns = deriveTrendAnnotations([pt("s2", 2, 50, "L2"), digest]);
    expect(anns).toHaveLength(1);
    expect(anns[0]!.prevScanId).toBeNull();
  });
});

describe("deploy markers carry 'what this deploy changed'", () => {
  const scans = [pt("s5", 5, 70, "L3", "e".repeat(40)), pt("s4", 4, 66, "L3", "d".repeat(40))];
  const dep = (sha: string) => ({ environment: "production", sha, state: "success", createdAt: "2026-09-04T12:00:00.000Z" });

  it("a deploy pinned to s5 with older real scan s4 carries prevScanId s4", () => {
    const [m] = deriveDeployAnnotations(scans, [dep("e".repeat(40))]);
    expect(m?.scanId).toBe("s5");
    expect(m?.prevScanId).toBe("s4");
  });

  it("a deploy pinned to the oldest real scan carries prevScanId null", () => {
    const [m] = deriveDeployAnnotations(scans, [dep("d".repeat(40))]);
    expect(m?.scanId).toBe("s4");
    expect(m?.prevScanId).toBeNull();
  });
});

describe("pairCompareHref", () => {
  it("builds the compare URL: a = newer, b = older", () => {
    expect(pairCompareHref("o/r", { afterId: "s3", beforeId: "s2" })).toBe("/report/compare?repo=o%2Fr&a=s3&b=s2");
  });

  it("uses the same encoding as historyReturnPath('compare')", () => {
    expect(pairCompareHref("o/r", { afterId: "s3", beforeId: "s2" })).toBe(
      historyReturnPath("compare", { repo: "o/r", a: "s3", b: "s2" }),
    );
  });

  it("refuses a missing baseline, a compacted side and a self-pair", () => {
    expect(pairCompareHref("o/r", { afterId: "s3", beforeId: null })).toBeNull();
    expect(pairCompareHref("o/r", { afterId: "digest:x", beforeId: "s2" })).toBeNull();
    expect(pairCompareHref("o/r", { afterId: "s3", beforeId: "digest:x" })).toBeNull();
    expect(pairCompareHref("o/r", { afterId: "s3", beforeId: "s3" })).toBeNull();
  });

  it("mirrors the db's compacted-id guard exactly", () => {
    for (const id of [`${COMPACTED_POINT_ID_PREFIX}2026-01`, "s1", "digest", ""]) {
      expect(isCompactedId(id)).toBe(isCompactedPointId(id));
    }
  });
});

describe("pickReducer", () => {
  const order = ["s1", "s2", "s3", "s4", "digest:p"];
  const pick = (s: PickState, id: string) => pickReducer(s, { type: "pick", id, order });

  it("one pick, then a pair with chronological roles regardless of click order", () => {
    const one = pick(EMPTY_PICK, "s1");
    expect(one).toEqual({ selected: ["s1"] });
    const two = pick(one, "s4");
    const pair = pickedPair(two)!;
    expect(pairCompareHref("o/r", pair)).toBe("/report/compare?repo=o%2Fr&a=s4&b=s1");
    // Reverse click order: same roles.
    const reversed = pickedPair(pick(pick(EMPTY_PICK, "s4"), "s1"))!;
    expect(reversed).toEqual(pair);
  });

  it("picking a selected point again deselects it", () => {
    const two = pick(pick(EMPTY_PICK, "s1"), "s4");
    expect(pick(two, "s4")).toEqual({ selected: ["s1"] });
  });

  it("a third pick replaces the older of the two", () => {
    const two = pick(pick(EMPTY_PICK, "s1"), "s4");
    expect(pick(two, "s2")).toEqual({ selected: ["s2", "s4"] });
  });

  it("a compacted id or an id off the chart leaves the state unchanged", () => {
    const one = pick(EMPTY_PICK, "s1");
    expect(pick(one, "digest:p")).toBe(one);
    expect(pick(one, "nope")).toBe(one);
  });

  it("retain drops picks that left the slice; clear empties", () => {
    const two = pick(pick(EMPTY_PICK, "s1"), "s4");
    expect(pickReducer(two, { type: "retain", ids: ["s3", "s4"] })).toEqual({ selected: ["s4"] });
    expect(pickReducer(two, { type: "clear" })).toEqual(EMPTY_PICK);
  });
});
