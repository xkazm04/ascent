// WHAT THE PANEL WILL SEND, PUT THROUGH THE ROUTE'S OWN VALIDATOR.
//
// The assertion that matters is not "the builder produces something": it is that what the builder
// produces survives `normalizeArmSet` — the real function, imported, not a copy of its rules. A panel
// that validates with its own list and a route that validates with `arm.ts` agree until the day they
// do not, and that day is a 400 an operator cannot read.

import { describe, expect, it } from "vitest";
import { isSplitArm, normalizeArmSet, planArmOf } from "@/lib/local/arm";
import {
  armRequestFields,
  canAddArm,
  canRemoveArm,
  draftsForPolicy,
  draftsToArms,
  isBelowFloor,
  needsFloorOptIn,
  newArmDraft,
  transportsOf,
  type ArmDraft,
} from "./armDraft";

const draft = (over: Partial<ArmDraft>): ArmDraft => ({ ...newArmDraft(), ...over });

describe("armDraft → the wire", () => {
  it("a four-arm compare set with a split arm round-trips through the real validator", () => {
    const drafts: ArmDraft[] = [
      draft({ transport: "claude", model: "sonnet" }),
      draft({ transport: "claude", model: "opus" }),
      // Claude plans, the local model executes — the configuration the old model/effort pair could
      // not express at all.
      draft({ transport: "pi", model: "qwen3.8:27b", plan: { transport: "claude", model: "sonnet" } }),
      draft({ transport: "pi", model: "qwen3.8:27b", floorAck: true }),
    ];

    const body = armRequestFields(drafts, "compare");
    expect(body).not.toBeNull();

    const arms = normalizeArmSet(body!.arms, body!.armPolicy);
    expect(arms).not.toBeNull();
    expect(arms!).toHaveLength(4);
    expect(new Set(arms!.map((a) => a.id)).size).toBe(4);

    const split = arms![2];
    expect(isSplitArm(split)).toBe(true);
    expect(planArmOf(split)).toEqual({ transport: "claude", model: "sonnet" });
    // A Claude-planned arm is NOT below the floor, however local its executing half is.
    expect(split.belowFloor).toBeUndefined();
    expect(split.label).toBe("claude:sonnet plan -> pi:qwen3.8:27b");

    expect(arms![3].belowFloor).toBe(true);
    expect(transportsOf(drafts)).toEqual(["claude", "pi"]);
  });

  it("marks a below-floor arm and refuses the whole set until it is opted in", () => {
    const local = draft({ transport: "pi", model: "qwen3.8:27b" });
    expect(isBelowFloor(local)).toBe(true);
    expect(needsFloorOptIn(local)).toBe(true);
    expect(draftsToArms([local], "single")).toBeNull();
    expect(armRequestFields([local], "single")).toBeNull();

    const armed = draftsToArms([{ ...local, floorAck: true }], "single");
    expect(armed![0].belowFloor).toBe(true);
  });

  it("treats a local PLANNING half as below the floor even when Claude executes", () => {
    const inverted = draft({ transport: "claude", model: "sonnet", plan: { transport: "pi", model: "qwen3.8:27b" } });
    expect(isBelowFloor(inverted)).toBe(true);
    expect(draftsToArms([inverted], "single")).toBeNull();
  });

  it("refuses a model the spawn door would refuse, rather than inventing its own message", () => {
    expect(draftsToArms([draft({ transport: "pi", model: "rm -rf /", floorAck: true })], "single")).toBeNull();
    expect(draftsToArms([draft({ transport: "pi", model: "", floorAck: true })], "single")).toBeNull();
  });

  it("holds the policy's own bounds: single is one, compare is 2..4", () => {
    const two = draftsForPolicy([draft({})], "compare");
    expect(two).toHaveLength(2);
    expect(draftsToArms(two, "single")).toBeNull();
    expect(draftsForPolicy(two, "single")).toHaveLength(1);

    expect(canAddArm("single", 1)).toBe(false);
    expect(canRemoveArm("compare", 2)).toBe(false);
    expect(canAddArm("compare", 4)).toBe(false);
    expect(canAddArm("compare", 3)).toBe(true);
  });

  it("gives two rows on the same model distinct ids — the id is what joins a lane to its arm", () => {
    const same = [draft({ transport: "claude", model: "sonnet" }), draft({ transport: "claude", model: "sonnet" })];
    const arms = draftsToArms(same, "compare");
    expect(arms!.map((a) => a.id)).toEqual(["claude-sonnet-1", "claude-sonnet-2"]);
  });
});
