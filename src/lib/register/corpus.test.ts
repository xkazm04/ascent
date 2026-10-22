// The public-corpus door (card portfolio-0). Every public ranking - /leaderboard, the landing register,
// the /about live fleet - reads the same corpus, so they must agree on three things: which rows are
// public (tenancy), which scores may be ranked (provenance), and in what order (one comparator).

import { describe, it, expect } from "vitest";
import { BENCHMARK_ELIGIBLE, MOCK_ENGINE, isMockEngine } from "@/lib/corpus/eligibility";
import { RANKABLE_ENGINE_WHERE, byRank, isRankableScan, publicCorpusWhere, publicRowOrNull } from "./corpus";

describe("isRankableScan - the engine half of BENCHMARK_ELIGIBLE, as a predicate", () => {
  it("never ranks a mock score", () => {
    expect(isRankableScan("mock")).toBe(false);
  });

  it("ranks a model-scored row", () => {
    expect(isRankableScan("anthropic")).toBe(true);
    expect(isRankableScan("claude-cli")).toBe(true);
  });

  it("treats an unknown engine as unrankable - unknown provenance is not evidence", () => {
    expect(isRankableScan(null)).toBe(false);
    expect(isRankableScan(undefined)).toBe(false);
    expect(isRankableScan("")).toBe(false);
  });

  it("is derived from the same constant the benchmark filter uses, not a fourth literal", () => {
    expect(BENCHMARK_ELIGIBLE.engineProvider).toEqual({ not: MOCK_ENGINE });
    expect(RANKABLE_ENGINE_WHERE).toEqual({ engineProvider: BENCHMARK_ELIGIBLE.engineProvider });
    expect(isMockEngine(MOCK_ENGINE)).toBe(true);
    expect(isRankableScan(MOCK_ENGINE)).toBe(!isMockEngine(MOCK_ENGINE));
  });

  it("does not read the rubric half: a stale-rubric row stays rankable (qualified, not de-ranked)", () => {
    // The predicate takes the engine only, so there is no rubric argument to get wrong.
    expect(isRankableScan.length).toBe(1);
  });
});

describe("publicCorpusWhere / publicRowOrNull - tenancy in the where AND per row", () => {
  it("pins the public org and isPrivate:false", () => {
    expect(publicCorpusWhere("org-public")).toEqual({ orgId: "org-public", isPrivate: false });
  });

  it("refuses a private row whatever the query returned", () => {
    expect(publicRowOrNull({ id: "a", isPrivate: true })).toBeNull();
  });

  it("passes a public row through unchanged", () => {
    const row = { id: "a", isPrivate: false };
    expect(publicRowOrNull(row)).toBe(row);
  });
});

describe("byRank - one comparator for every public board", () => {
  const e = (fullName: string, overall: number, scannedAt = "2026-10-01T00:00:00.000Z") => ({
    fullName,
    overall,
    scannedAt,
  });

  it("orders by score, then the more recent scan, then fullName", () => {
    const rows = [
      e("acme/c", 70),
      e("acme/b", 70),
      e("acme/old", 70, "2026-09-01T00:00:00.000Z"),
      e("acme/a", 80),
    ];
    expect([...rows].sort(byRank).map((r) => r.fullName)).toEqual(["acme/a", "acme/b", "acme/c", "acme/old"]);
  });
});
