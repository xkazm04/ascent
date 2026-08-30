import { describe, expect, it } from "vitest";
import { fixFirstDims, pickMovers, postureLine, standingOf, takeawayOf, trendVerb } from "./overviewTakeaway";
import type { DimensionReading } from "./dimensionReading";
import type { RepoTrajectory } from "./repoTrajectory";

const badges = [
  { label: "Org maturity", value: 62, sub: "L3 · Augmented", delta: 4 },
  { label: "AI Adoption", value: 70, delta: 2 },
  { label: "Engineering Rigor", value: 55 },
  { label: "Repos scanned", value: "3/40" },
];

const reading = (dimId: string, short: string, avg: number, rank: number, owed: boolean): DimensionReading =>
  ({ dimId, short, avg, rank, owed, total: 9, delta: null, status: "", name: short, belowGreen: { n: 1, of: 1 }, note: "", practice: null }) as DimensionReading;

describe("standingOf", () => {
  it("lifts figure, level, delta and coverage off the badge list by label", () => {
    expect(standingOf(badges)).toEqual({ overall: 62, levelId: "L3", levelName: "Augmented", delta: 4, adoption: 70, rigor: 55, scanned: 3, repos: 40 });
  });
  it("reads an unscanned view as NO standing rather than a 0 grade", () => {
    const s = standingOf([{ label: "Org maturity", value: 0, sub: "L1 · Manual" }, { label: "Repos scanned", value: "0/12" }]);
    expect(s.overall).toBeNull();
    expect(s.levelName).toBeNull();
    expect(s.repos).toBe(12);
  });
});

describe("takeawayOf", () => {
  it("composes a <= 8-word sentence from the standing and the weakest owed dimension", () => {
    const t = takeawayOf(standingOf(badges), [reading("D2", "Testing", 31, 1, true), reading("D1", "AI Tooling", 80, 9, false)]);
    expect(t.lead).toBe("Augmented at 62, climbing.");
    expect(t.action).toBe("Testing owes first.");
    expect(`${t.lead} ${t.action}`.split(" ").length).toBeLessThanOrEqual(8);
  });
  it("says every dimension is green when nothing is owed", () => {
    expect(takeawayOf(standingOf(badges), [reading("D1", "AI Tooling", 80, 1, false)]).action).toBe("Every dimension is green.");
  });
  it("designs the zero state", () => {
    expect(takeawayOf(standingOf([]), []).lead).toBe("No standing yet.");
  });
});

describe("trendVerb", () => {
  it("mutes a within-noise wobble to holding", () => {
    expect(trendVerb(1)).toBe("holding");
    expect(trendVerb(8)).toBe("climbing");
    expect(trendVerb(-8)).toBe("slipping");
    expect(trendVerb(null)).toBe("no baseline yet");
  });
});

describe("fixFirstDims / pickMovers / postureLine", () => {
  it("returns owed dimensions weakest first, capped", () => {
    const rows = [reading("D1", "a", 60, 3, true), reading("D2", "b", 20, 1, true), reading("D3", "c", 40, 2, true), reading("D4", "d", 90, 9, false)];
    expect(fixFirstDims(rows, 2).map((r) => r.dimId)).toEqual(["D2", "D3"]);
  });
  it("picks the largest real movers each way and ignores engine transitions", () => {
    const t = (name: string, deltaWindow: number | null, tone: "rising" | "falling" | "flat", deltaCrossesEngine = false) =>
      ({ name, fullName: `o/${name}`, deltaWindow, tone, deltaCrossesEngine, overall: 50, engine: "claude" }) as RepoTrajectory;
    const m = pickMovers([t("a", 9, "rising"), t("b", 12, "rising"), t("c", -7, "falling"), t("d", 30, "rising", true), t("e", null, "flat")]);
    expect(m.risers.map((r) => r.name)).toEqual(["b", "a"]);
    expect(m.fallers.map((r) => r.name)).toEqual(["c"]);
    expect(m.moved).toBe(3);
  });
  it("omits zero-count postures from the line", () => {
    expect(postureLine({ "ai-native": 2, early: 0 }, ["ai-native", "early"], (p) => p)).toBe("2 ai-native");
  });
});
