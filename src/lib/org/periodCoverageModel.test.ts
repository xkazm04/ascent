// The in-period coverage of a windowed fleet rollup: which scored repos count in the average from a
// scan older than the window start (carried), and which of those one click can rescan. Card rollups-1.

import { describe, expect, it } from "vitest";
import { periodCoverage, periodCoverageCaption, type CoverageRow } from "./periodCoverageModel";

const START = new Date("2026-07-01T00:00:00Z");
const NOW = Date.parse("2026-07-20T00:00:00Z");

function row(i: number, scannedAt: string | null, over: Partial<CoverageRow> & { engine?: string; queued?: boolean } = {}): CoverageRow {
  return {
    fullName: over.fullName ?? `a/r${i}`,
    name: over.name ?? `r${i}`,
    watched: over.watched ?? true,
    latest: scannedAt ? { scannedAt, engine: over.engine ?? "anthropic" } : null,
    freshness: { queuedRescore: over.queued ?? false },
  };
}

/** 42 scored rows: 35 scanned in July, 7 carried from June (2 queued, 1 unwatched). */
function fleet(): CoverageRow[] {
  const rows: CoverageRow[] = [];
  for (let i = 0; i < 35; i++) rows.push(row(i, "2026-07-10T00:00:00Z"));
  rows.push(row(100, "2026-06-20T00:00:00Z"));
  rows.push(row(101, "2026-05-01T00:00:00Z", { queued: true }));
  rows.push(row(102, "2026-06-01T00:00:00Z", { queued: true }));
  rows.push(row(103, "2026-04-01T00:00:00Z", { watched: false }));
  rows.push(row(104, "2026-06-25T00:00:00Z"));
  rows.push(row(105, "2026-06-30T23:59:59Z"));
  rows.push(row(106, "2026-03-15T00:00:00Z"));
  return rows;
}

describe("periodCoverage - counts and names the carried repos", () => {
  it("42 scored, 7 before start -> 35 in period and 7 carried oldest-first with lastScoredAt", () => {
    const c = periodCoverage(fleet(), START, NOW)!;
    expect(c.total).toBe(42);
    expect(c.inPeriod).toBe(35);
    expect(c.carried).toHaveLength(7);
    expect(c.carried.map((r) => r.fullName)).toEqual(["a/r106", "a/r103", "a/r101", "a/r102", "a/r100", "a/r104", "a/r105"]);
    expect(c.carried[0].lastScoredAt).toBe("2026-03-15T00:00:00Z");
    expect(c.carried[0].ageDays).toBe(127);
  });

  it("all time (start null) -> null: nothing to disclose", () => {
    expect(periodCoverage(fleet(), null, NOW)).toBeNull();
  });

  it("splits the carried set into the rescan set, the already queued and the unwatched", () => {
    const c = periodCoverage(fleet(), START, NOW)!;
    expect([...c.rescanSet].sort()).toEqual(["a/r100", "a/r104", "a/r105", "a/r106"]);
    expect(c.alreadyQueued).toBe(2);
    expect(c.notWatched).toBe(1);
    expect(c.action).toEqual({ state: "rescan", count: 4 });
  });

  it("every carried repo already queued -> 'queued', never a button that would re-enqueue", () => {
    const rows = [row(1, "2026-07-02T00:00:00Z"), row(2, "2026-06-01T00:00:00Z", { queued: true }), row(3, "2026-05-01T00:00:00Z", { queued: true })];
    const c = periodCoverage(rows, START, NOW)!;
    expect(c.rescanSet).toEqual([]);
    expect(c.action).toEqual({ state: "queued", count: 2 });
  });

  it("only unwatched repos carried -> 'unwatched' with no rescan set", () => {
    const rows = [row(1, "2026-07-02T00:00:00Z"), row(2, "2026-06-01T00:00:00Z", { watched: false })];
    expect(periodCoverage(rows, START, NOW)!.action).toEqual({ state: "unwatched", count: 1 });
  });

  it("counts the population the average stands on: unscanned and mock-floor rows are not in it", () => {
    const rows = [row(1, "2026-07-02T00:00:00Z"), row(2, null), row(3, "2026-06-01T00:00:00Z", { engine: "mock" }), row(4, "2026-06-01T00:00:00Z")];
    const c = periodCoverage(rows, START, NOW)!;
    expect(c.total).toBe(2);
    expect(c.carried.map((r) => r.fullName)).toEqual(["a/r4"]);
  });
});

describe("periodCoverageCaption - the counted caveat", () => {
  it("names the count and the consequence", () => {
    expect(periodCoverageCaption({ inPeriod: 35, total: 42 })).toBe(
      "7 of 42 repos have no scan this period: they count in the fleet average from their earlier scan and do not appear in movers.",
    );
  });

  it("agrees in the singular and is null when nothing is carried", () => {
    expect(periodCoverageCaption({ inPeriod: 41, total: 42 })).toBe(
      "1 of 42 repos has no scan this period: it counts in the fleet average from its earlier scan and does not appear in movers.",
    );
    expect(periodCoverageCaption({ inPeriod: 42, total: 42 })).toBeNull();
  });

  it("carries no em dash", () => {
    expect(periodCoverageCaption({ inPeriod: 1, total: 9 })).not.toContain("\u2014");
  });
});
