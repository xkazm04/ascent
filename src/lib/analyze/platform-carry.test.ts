// Carrying a platform fold into a scan that could not observe one.
//
// The cases below are the three readings a loop rescan can produce, and the whole point of the change
// is that they are three DIFFERENT readings rather than one silent floor: the fold replayed from a
// fresh observation, the same fold replayed from a stale one and saying so, and no fold at all — which
// must declare D2/D3/D4 unmeasurable rather than score them at the file-scan floor.

import { describe, expect, it } from "vitest";
import type { DimensionSignals, PlatformSignalRecord } from "@/lib/types";
import {
  PLATFORM_FOLD_DIMS,
  PLATFORM_FOLD_STALE_DAYS,
  carryPlatformFold,
  isPlatformFoldStale,
  parsePlatformSignals,
  platformFoldNote,
  platformSignalsUnavailable,
  unmeasurablePlatformDims,
} from "@/lib/analyze/platform-carry";
import { applyPlatformSignals } from "@/lib/analyze/platform-signals";
import type { AppInventory } from "@/lib/github/check-suites";
import type { CiHealth } from "@/lib/github/actions-health";

const NOW = new Date("2026-08-28T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const dim = (id: string, signalScore: number, labels: string[] = []): DimensionSignals =>
  ({
    id,
    name: id,
    weight: 1,
    signalScore,
    signals: labels.map((label) => ({ label })),
    gaps: [],
  }) as unknown as DimensionSignals;

const baseSignals = (): DimensionSignals[] => [dim("D1", 50), dim("D2", 40), dim("D3", 30), dim("D4", 20)];

const inventory: AppInventory = {
  sha: "abc",
  total: 2,
  truncated: false,
  apps: [
    { slug: "claude", name: "Claude", conclusion: "success" },
    { slug: "codecov", name: "Codecov", conclusion: "success" },
  ],
};

const ciHealth: CiHealth = {
  branch: "main",
  sampled: 20,
  successRate: 95,
  medianDurationMin: 6,
  latestRunAt: daysAgo(1),
  workflows: 3,
  failing: [],
};

/** The GitHub-side reading a local rescan later replays. */
function observed(observedAt = daysAgo(1)) {
  return applyPlatformSignals(baseSignals(), inventory, ciHealth, { observedAt });
}

describe("applyPlatformSignals — the fold becomes a value", () => {
  it("records the points and the evidence each fold dimension gained", () => {
    const { signals, record } = observed();
    expect(record?.source).toBe("observed");
    // Every recorded dimension is one the folds are allowed to move, and each carries what it earned.
    expect(record!.dims.map((d) => d.dimId).sort()).toEqual(["D2", "D3", "D4"]);
    for (const d of record!.dims) {
      expect(d.points).toBeGreaterThan(0);
      expect(d.signals.length).toBeGreaterThan(0);
    }
    // The recorded points are exactly the difference the fold made, not a re-derivation of it.
    const byId = new Map(signals.map((s) => [s.id, s.signalScore]));
    for (const d of record!.dims) {
      const before = baseSignals().find((s) => s.id === d.dimId)!.signalScore;
      expect(byId.get(d.dimId)! - before).toBe(d.points);
    }
  });

  it("records NOTHING when neither enrichment was read — that decision is the caller's", () => {
    // A null pair means "could not look", and whether that is `unavailable` or "carry an older fold"
    // is not knowable here. Manufacturing a record would take the choice away from the only caller
    // that can make it.
    const { record } = applyPlatformSignals(baseSignals(), null, null, { observedAt: daysAgo(0) });
    expect(record).toBeNull();
  });
});

describe("carryPlatformFold — a FRESH snapshot", () => {
  it("reproduces the observed scores exactly, so the pair is comparable again", () => {
    const live = observed(daysAgo(2));
    const carried = carryPlatformFold(baseSignals(), { record: live.record!, scanId: "scan_1" }, NOW);
    const liveScores = new Map(live.signals.map((s) => [s.id, s.signalScore]));
    for (const s of carried.signals) expect(s.signalScore).toBe(liveScores.get(s.id));
  });

  it("stamps every carried evidence line with the scan it came from and how old it is", () => {
    const live = observed(daysAgo(3));
    const carried = carryPlatformFold(baseSignals(), { record: live.record!, scanId: "scan_1" }, NOW);
    const d3 = carried.signals.find((s) => s.id === "D3")!;
    const added = d3.signals.filter((sig) => sig.detail?.includes("platform signals from scan scan_1"));
    expect(added.length).toBeGreaterThan(0);
    expect(added[0]!.detail).toContain("3d old");
    expect(added[0]!.detail).not.toContain("STALE");
  });

  it("records itself as CARRIED, keeping the original observation time", () => {
    const at = daysAgo(3);
    const live = observed(at);
    const { record } = carryPlatformFold(baseSignals(), { record: live.record!, scanId: "scan_1" }, NOW);
    expect(record.source).toBe("carried");
    expect(record.fromScanId).toBe("scan_1");
    // The age a reader judges is the age of the OBSERVATION, never of the scan that borrowed it.
    expect(record.observedAt).toBe(at);
    expect(record.stale).toBeUndefined();
    expect(platformFoldNote(record, NOW)).toBe("platform signals from scan scan_1, 3d old");
  });

  it("never decorates a crashed detector, exactly as the live folds refuse to", () => {
    const failed = [{ ...dim("D3", 0), failed: true } as unknown as DimensionSignals];
    const live = observed();
    const { signals } = carryPlatformFold(failed, { record: live.record!, scanId: "scan_1" }, NOW);
    expect(signals[0]!.signalScore).toBe(0);
    expect(signals[0]!.signals).toEqual([]);
  });
});

describe("carryPlatformFold — a STALE snapshot", () => {
  const stalely = () => observed(daysAgo(PLATFORM_FOLD_STALE_DAYS + 1));

  it("still applies the fold — a stale reading is the best evidence there is", () => {
    const live = stalely();
    const carried = carryPlatformFold(baseSignals(), { record: live.record!, scanId: "old" }, NOW);
    const liveScores = new Map(live.signals.map((s) => [s.id, s.signalScore]));
    for (const s of carried.signals) expect(s.signalScore).toBe(liveScores.get(s.id));
  });

  it("marks it stale on the record AND on every line it added", () => {
    const carried = carryPlatformFold(baseSignals(), { record: stalely().record!, scanId: "old" }, NOW);
    expect(carried.record.stale).toBe(true);
    expect(platformFoldNote(carried.record, NOW)).toContain("stale");
    const d2 = carried.signals.find((s) => s.id === "D2")!;
    expect(d2.signals.at(-1)!.detail).toContain("STALE");
  });

  it("is exactly the documented threshold, and an unknown age is not stale", () => {
    expect(isPlatformFoldStale(observed(daysAgo(PLATFORM_FOLD_STALE_DAYS)).record, NOW)).toBe(false);
    expect(isPlatformFoldStale(observed(daysAgo(PLATFORM_FOLD_STALE_DAYS + 1)).record, NOW)).toBe(true);
    // Unknown is not a finding: a record with no observation time is carried without a stale claim.
    expect(isPlatformFoldStale({ source: "carried", observedAt: null, dims: [] }, NOW)).toBe(false);
  });
});

describe("no snapshot at all", () => {
  it("is `unavailable`, which names the three dimensions as unmeasurable", () => {
    const record = platformSignalsUnavailable();
    expect(record.source).toBe("unavailable");
    expect(unmeasurablePlatformDims(record)).toEqual([...PLATFORM_FOLD_DIMS]);
    expect(platformFoldNote(record)).toBe("D2/D3/D4 not measurable locally");
  });

  it("an observed or carried reading excludes NOTHING — those dimensions were measured", () => {
    expect(unmeasurablePlatformDims(observed().record)).toEqual([]);
    const carried = carryPlatformFold(baseSignals(), { record: observed().record!, scanId: "s" }, NOW).record;
    expect(unmeasurablePlatformDims(carried)).toEqual([]);
  });

  it("an UNKNOWN record excludes nothing either — a legacy row is not a claim of unavailability", () => {
    // This is the load-bearing asymmetry: reading `undefined` as "unavailable" would silently drop
    // three dimensions out of every historical green verdict.
    expect(unmeasurablePlatformDims(undefined)).toEqual([]);
    expect(unmeasurablePlatformDims(null)).toEqual([]);
    expect(platformFoldNote(undefined)).toBeNull();
  });

  it("an OBSERVED reading discloses nothing on screen — reading GitHub is the ordinary case", () => {
    expect(platformFoldNote(observed().record)).toBeNull();
  });
});

describe("parsePlatformSignals", () => {
  it("round-trips a persisted record", () => {
    const record = carryPlatformFold(baseSignals(), { record: observed().record!, scanId: "s" }, NOW).record;
    expect(parsePlatformSignals(JSON.stringify(record))).toEqual(record);
  });

  it("reads anything unrecognisable as UNKNOWN rather than as a defaulted shape", () => {
    expect(parsePlatformSignals(null)).toBeUndefined();
    expect(parsePlatformSignals("not json")).toBeUndefined();
    expect(parsePlatformSignals(JSON.stringify({ source: "invented", dims: [] }))).toBeUndefined();
  });

  it("normalizes a dim missing its evidence, so a replay cannot crash the scan it enriches", () => {
    const raw = JSON.stringify({ source: "observed", observedAt: daysAgo(1), dims: [{ dimId: "D3", points: 8 }] });
    const record = parsePlatformSignals(raw) as PlatformSignalRecord;
    expect(record.dims).toEqual([{ dimId: "D3", points: 8, signals: [] }]);
    const carried = carryPlatformFold(baseSignals(), { record, scanId: "s" }, NOW);
    expect(carried.signals.find((s) => s.id === "D3")!.signalScore).toBe(38);
  });
});
