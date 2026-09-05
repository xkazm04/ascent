// The fleet stream's `progress` contract (src/lib/scan-stage.ts).
//
// The regression this pins is the one the sub-stage frames could easily have introduced: a consumer
// counting "analyze" as a repo. Every frame — boundary or sub-stage — carries the same index/total,
// and the fold ASSIGNS rather than increments, so a burst of six sub-stage frames must leave `done`
// exactly where the repo boundary put it.

import { describe, expect, it } from "vitest";
import { SCAN_SUBSTAGES, foldProgressFrame, isSubstageFrame, type ScanProgressState } from "@/lib/scan-stage";

const start: ScanProgressState = { done: 0, total: 3, current: "", stage: null };

describe("isSubstageFrame", () => {
  it("accepts every scanner stage and rejects the repo boundary", () => {
    for (const s of SCAN_SUBSTAGES) expect(isSubstageFrame(s)).toBe(true);
    expect(isSubstageFrame("scan")).toBe(false);
    expect(isSubstageFrame("done")).toBe(false);
    expect(isSubstageFrame(undefined)).toBe(false);
    expect(isSubstageFrame(7)).toBe(false);
  });
});

describe("foldProgressFrame", () => {
  it("a repo boundary sets the repo and clears the sub-stage", () => {
    const s = foldProgressFrame(start, { stage: "scan", repo: "acme/web", index: 0, total: 3 });
    expect(s).toEqual({ done: 0, total: 3, current: "acme/web", stage: null });
  });

  it("sub-stage frames never advance the counters (the whole point)", () => {
    let s = foldProgressFrame(start, { stage: "scan", repo: "acme/web", index: 1, total: 3 });
    for (const stage of SCAN_SUBSTAGES) {
      s = foldProgressFrame(s, { stage, repo: "acme/web", index: 1, total: 3, pct: 40 });
      expect(s.done).toBe(1);
      expect(s.total).toBe(3);
      expect(s.current).toBe("acme/web");
      expect(s.stage).toBe(stage);
    }
    // …and the next boundary moves it by exactly one, clearing the stage.
    s = foldProgressFrame(s, { stage: "scan", repo: "acme/api", index: 2, total: 3 });
    expect(s).toEqual({ done: 2, total: 3, current: "acme/api", stage: null });
  });

  it("keeps the previous counters when a frame omits or garbles them", () => {
    const seeded = foldProgressFrame(start, { stage: "scan", repo: "acme/web", index: 2, total: 3 });
    expect(foldProgressFrame(seeded, { stage: "analyze", repo: "acme/web" })).toEqual({
      done: 2,
      total: 3,
      current: "acme/web",
      stage: "analyze",
    });
    expect(foldProgressFrame(seeded, { stage: "analyze", index: "nope", total: null })).toMatchObject({
      done: 2,
      total: 3,
      current: "acme/web",
    });
  });

  it("honours a shrinking denominator (the credit-truncated run's `notice`)", () => {
    const seeded = foldProgressFrame(start, { stage: "scan", repo: "acme/web", index: 1, total: 3 });
    expect(foldProgressFrame(seeded, { stage: "scan", repo: "acme/api", index: 2, total: 2 }).total).toBe(2);
  });

  it("an unknown stage is treated as a boundary, not as sub-progress", () => {
    const s = foldProgressFrame(start, { stage: "teleporting", repo: "acme/web", index: 1, total: 3 });
    expect(s.stage).toBeNull();
    expect(s.done).toBe(1);
  });
});
