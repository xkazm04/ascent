import { describe, expect, it } from "vitest";
import { headerStatus } from "./headerStatus";
import type { LoopRunRecord } from "./loopTypes";

const run = { cycle: 2, maxCycles: 5 } as LoopRunRecord;

describe("headerStatus (shared by the v1 caption and the Prism figures)", () => {
  it("says 'at rest' only when nothing is live and no drive is pulling", () => {
    expect(headerStatus({ fleetCount: 2, active: null, laneCount: 0, live: false }).map((p) => p.text)).toEqual(["2 repos", "at rest"]);
  });
  it("prints lanes and cycle for a live run, pluralised", () => {
    const p = headerStatus({ fleetCount: 3, active: run, laneCount: 1, live: true });
    expect(p.map((x) => x.text)).toEqual(["3 repos", "1 lane · cycle 2/5"]);
    expect(p[1].live).toBe(true);
    expect(headerStatus({ fleetCount: 3, active: run, laneCount: 2, live: true })[1].text).toBe("2 lanes · cycle 2/5");
  });
  it("a drive caption stands in for 'at rest' between runs (no active run) and never adds it", () => {
    const p = headerStatus({ fleetCount: 2, active: null, laneCount: 0, live: true, driveCaption: "drive 1/3" });
    expect(p.map((x) => x.text)).toEqual(["2 repos", "drive 1/3"]);
  });
  it("live without an active run and without a drive reads at rest (a poll gap is not a claim)", () => {
    expect(headerStatus({ fleetCount: 1, active: null, laneCount: 0, live: true }).map((x) => x.text)).toEqual(["1 repos", "at rest"]);
  });
});
