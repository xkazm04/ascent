// Pins the dimension ledger's headline shape: which SDLC phase carries the debt, and — the part the
// sentence this replaced could not enforce — which phases may print an average at all.
//
// A phase average is a mean of dimension averages. The rollup can hand back a dimension average with
// NO scored repository behind it (a legacy scan, an engine that returned a short dim list); the
// ledger row has always worded that as "no repos scored on this dimension" and then printed the
// number anyway. On the strip it is `not-judged`, and `rendersValue` is false there, so the strip
// cannot print it. These tests pin the state, which is what the drawing reads.

import { describe, expect, it } from "vitest";
import { rendersValue } from "@/components/org/viz";
import { buildDimensionReadings } from "@/features/standing/overview/dimensionReading";
import { GREEN_FLOOR, owedCount, phaseStandings } from "@/features/standing/overview/phaseStanding";

const AUTHOR = ["D1", "D4", "D8"];
const VERIFY = ["D2", "D6", "D9"];
const SHIP = ["D3", "D7", "D5"];
const ALL = [...AUTHOR, ...VERIFY, ...SHIP];

/** Fleet dimension averages: every dimension at `base`, overridden per id by `over`. */
const dims = (base: number, over: Record<string, number> = {}) => ALL.map((dimId) => ({ dimId, avg: over[dimId] ?? base }));

/** One scanned repo carrying `ids` at `score` — the "below green in N of M repos" denominator. */
const repo = (ids: string[], score: number) => ({ dims: ids.map((dimId) => ({ dimId, score })) });

describe("phaseStandings", () => {
  it("returns the three SDLC phases in pipeline order", () => {
    const p = phaseStandings(buildDimensionReadings(dims(70), null, [repo(ALL, 70)]));
    expect(p.map((x) => x.id)).toEqual(["author", "verify", "ship"]);
  });

  it("locates the debt: only the weak phase's average sits below the green floor", () => {
    const readings = buildDimensionReadings(
      dims(80, { D2: 30, D6: 30, D9: 30 }),
      null,
      [repo(ALL, 80)],
    );
    const [author, verify, ship] = phaseStandings(readings);
    expect(author!.avg).toBeGreaterThanOrEqual(GREEN_FLOOR);
    expect(ship!.avg).toBeGreaterThanOrEqual(GREEN_FLOOR);
    expect(verify!.avg).toBeLessThan(GREEN_FLOOR);
    expect(verify!.owed).toEqual({ n: 3, of: 3 });
  });

  it("marks a phase NOT JUDGED — and prints no average — when no repo scored any of its dimensions", () => {
    // Every dimension has a fleet average, but the only scanned repo carries just verify+ship, so
    // the author phase's 80 is an average with nothing behind it.
    const readings = buildDimensionReadings(dims(80), null, [repo([...VERIFY, ...SHIP], 80)]);
    const author = phaseStandings(readings).find((p) => p.id === "author")!;
    expect(author.state).toBe("not-judged");
    expect(author.avg).toBeNull();
    expect(rendersValue(author.state)).toBe(false);
  });

  it("marks the phases the rollup DID back as measured, in the same pass", () => {
    const readings = buildDimensionReadings(dims(80), null, [repo([...VERIFY, ...SHIP], 80)]);
    const measured = phaseStandings(readings).filter((p) => p.state === "measured");
    expect(measured.map((p) => p.id)).toEqual(["verify", "ship"]);
    expect(measured.every((p) => typeof p.avg === "number")).toBe(true);
  });

  it("drops a phase entirely when the rollup returned none of its dimensions", () => {
    // groupByPhase already filters an empty phase out, so the strip never draws a lane for a phase
    // that is not in the data at all — distinct from a phase that is present and unjudged.
    const readings = buildDimensionReadings(
      VERIFY.map((dimId) => ({ dimId, avg: 50 })),
      null,
      [repo(VERIFY, 50)],
    );
    expect(phaseStandings(readings).map((p) => p.id)).toEqual(["verify"]);
  });

  it("carries the phase's question, so the lane's title can answer 'why does this row exist'", () => {
    const p = phaseStandings(buildDimensionReadings(dims(70), null, [repo(ALL, 70)]));
    expect(p[0]!.question).toContain("AI");
    expect(p.every((x) => x.question.length > 0)).toBe(true);
  });
});

describe("owedCount", () => {
  it("counts the dimensions below the green floor, out of the dimensions in view", () => {
    const readings = buildDimensionReadings(dims(80, { D2: 30, D6: 30 }), null, [repo(ALL, 80)]);
    expect(owedCount(readings)).toEqual({ n: 2, of: 9 });
  });

  it("is zero-of-N, never an empty reading, when the whole fleet is green", () => {
    expect(owedCount(buildDimensionReadings(dims(90), null, [repo(ALL, 90)]))).toEqual({ n: 0, of: 9 });
  });
});
