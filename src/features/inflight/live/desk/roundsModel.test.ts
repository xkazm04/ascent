import { describe, expect, it } from "vitest";
import { foldArms, seqRange, splitArm } from "./armsModel";
import { deskLanes, deskRounds } from "./deskFixture";
import { foldRounds, verdictMix } from "./roundsModel";

describe("foldRounds", () => {
  const fold = foldRounds(deskRounds(), deskLanes());

  it("orders oldest first and splits chapters at a quiet gap", () => {
    expect(fold.rounds.map((r) => r.label)).toEqual(["#1", "#2", "#3", "#4"]);
    expect(fold.chapters).toEqual([
      { no: 1, from: 0, to: 1 },
      { no: 2, from: 2, to: 3 },
    ]);
    expect(fold.rounds[2]!.chapter).toBe(2);
  });

  it("sums only the lanes that reported a cost, and carries the count that did not", () => {
    const r1 = fold.byId.get("run-1")!;
    expect(r1.costMicros).toBeNull();
    expect(r1.costUnknown).toBe(1);
    const r3 = fold.byId.get("run-3")!;
    expect(r3.costMicros).toBe(300_000_000);
    expect(r3.costUnknown).toBe(0);
    expect(fold.totals.costMicros).toBe(450_000_000);
    expect(fold.totals.costUnknown).toBe(3);
  });

  it("counts a null verdict as unknown, never skipped, and an errored lane", () => {
    expect(fold.totals.verdicts).toEqual({ verified: 2, rejected: 1, baseline: 1, skipped: 0, unknown: 2 });
    expect(fold.byId.get("run-4")!.errors).toBe(1);
    expect(verdictMix(fold.byId.get("run-4")!.verdicts)).toBe("1 rejected · 1 unknown");
  });

  it("takes closes from the chronicle (the rescan's ruling)", () => {
    expect(fold.totals.closes).toBe(8);
  });

  it("with no lane grain, marks the lanes unknown and falls back to the chronicle's cost", () => {
    const blind = foldRounds(deskRounds(), null);
    expect(blind.rounds.every((r) => !r.lanesKnown && r.lanes.length === 0)).toBe(true);
    expect(blind.byId.get("run-3")!.costMicros).toBe(300_000_000);
    expect(blind.byId.get("run-4")!.costMicros).toBeNull();
  });
});

describe("foldArms", () => {
  const arms = foldArms(foldRounds(deskRounds(), deskLanes()).rounds);

  it("groups by label, keeps an unrecorded lane apart and never calls it default", () => {
    expect(arms.map((a) => a.key)).toEqual(["claude-opus-5", "claude:sonnet plan -> pi:qwen3.8:27b", "model not recorded"]);
  });

  it("prices a close only over lanes that recorded a cost", () => {
    const opus = arms[0]!;
    expect(opus.closes).toBe(8);
    expect(opus.perCloseMicros).toBe(450_000_000 / 8);
    const split = arms[1]!;
    expect(split.perCloseMicros).toBeNull();
    expect(split.costLanes).toBe(0);
    expect(split.errors).toBe(1);
    expect(seqRange(split)).toBe("#4");
  });

  it("splits a split arm into its planner and executor", () => {
    expect(splitArm("claude:sonnet plan -> pi:qwen3.8:27b")).toEqual({ exec: "pi:qwen3.8:27b", plan: "claude:sonnet" });
    expect(splitArm("opus")).toEqual({ exec: "opus", plan: null });
  });
});
