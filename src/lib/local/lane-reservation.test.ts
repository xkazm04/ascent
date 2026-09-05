// THE GREEN RESERVATION — the predicate and the mix, pure.
//
// The failure this pins: on two campaign repos whose every measured dimension sat above the band,
// each rescan raised one or two fresh gaps, so `openBatch` never returned an EMPTY gap list and the
// craft ladder — the only fallback r12 built — was starved across twelve runs.

import { describe, expect, it } from "vitest";
import { gapSlotsAtGreen, GAP_SLOTS_AT_GREEN, isMixedBatch, isReservationGreen, reserveCraftSlots } from "@/lib/local/lane-reservation";
import { FOLLOW_UP_BELOW } from "@/lib/maturity/model";
import type { FollowUpItem } from "@/lib/org/followups";

const dim = (dimId: string, score: number) => ({ dimId, score });

const item = (id: string, kind?: "gap" | "craft"): FollowUpItem => ({
  id,
  repo: "o/r",
  title: id,
  dimId: "D2",
  dimLabel: "Testing",
  impact: "high",
  effort: "low",
  rationale: "",
  explore: [],
  projectedPoints: kind === "craft" ? null : 3,
  ...(kind ? { kind } : {}),
});

const gaps = (n: number) => Array.from({ length: n }, (_, i) => item(`g${i + 1}`));
const rungs = (n: number) => Array.from({ length: n }, (_, i) => item(`c${i + 1}`, "craft"));

describe("isReservationGreen", () => {
  it("is TRUE for the campaign case — above the band on every dimension, but short of L5", () => {
    // The exact shape that starved the ladder: green by the loop's own floor, nowhere near L5, so
    // `repoGreenness().green` (an L5 question) says false and would have kept the reservation shut.
    expect(isReservationGreen("kiro/kp", [dim("D1", 81), dim("D5", 70), dim("D9", 65)])).toBe(true);
  });

  it("is FALSE when ANY measured dimension is below the band — a real hole gets no craft budget", () => {
    expect(isReservationGreen("o/r", [dim("D1", 90), dim("D5", FOLLOW_UP_BELOW - 1)])).toBe(false);
  });

  it("holds an UNMEASURABLE dimension out of the verdict rather than counting it as failed", () => {
    // A worktree rescan sees no GitHub-side fold, so D2/D3/D4 read at their file-scan floor. Judging
    // them would keep every loop repo permanently non-green and the reservation permanently shut.
    const dims = [dim("D1", 80), dim("D2", 10), dim("D3", 10), dim("D4", 10)];
    expect(isReservationGreen("o/r", dims)).toBe(false);
    expect(isReservationGreen("o/r", dims, ["D2", "D3", "D4"])).toBe(true);
  });

  it("refuses a VACUOUS green — every dimension excluded is evidence of nothing", () => {
    expect(isReservationGreen("o/r", [dim("D2", 10), dim("D3", 10)], ["D2", "D3"])).toBe(false);
  });

  it("refuses an UNSCANNED repo — no evidence is never green", () => {
    expect(isReservationGreen("o/r", [])).toBe(false);
  });
});

describe("reserveCraftSlots", () => {
  it("caps gaps at GAP_SLOTS_AT_GREEN and fills the rest from the ladder, gaps first", () => {
    const out = reserveCraftSlots(gaps(5), rungs(5), 5);
    expect(out.map((i) => i.id)).toEqual(["g1", "g2", "c1", "c2", "c3"]);
    expect(out.filter((i) => i.kind !== "craft")).toHaveLength(GAP_SLOTS_AT_GREEN);
  });

  it("returns GAPS ONLY when the ladder is empty — the cap is a reservation, not a ceiling", () => {
    expect(reserveCraftSlots(gaps(5), [], 5).map((i) => i.id)).toEqual(["g1", "g2", "g3", "g4", "g5"]);
  });

  it("tops the batch back up with gaps when the ladder is short of its reserved slots", () => {
    expect(reserveCraftSlots(gaps(5), rungs(1), 5).map((i) => i.id)).toEqual(["g1", "g2", "c1", "g3", "g4"]);
  });

  it("never exceeds the limit, and a limit of one still yields one item", () => {
    expect(reserveCraftSlots(gaps(5), rungs(5), 1).map((i) => i.id)).toEqual(["g1"]);
    expect(reserveCraftSlots(gaps(5), rungs(5), 3)).toHaveLength(3);
  });
});

describe("isMixedBatch", () => {
  it("is true only when BOTH a gap and a rung are present", () => {
    expect(isMixedBatch([...gaps(2), ...rungs(1)])).toBe(true);
    expect(isMixedBatch(gaps(2))).toBe(false);
    expect(isMixedBatch(rungs(2))).toBe(false);
    expect(isMixedBatch([])).toBe(false);
  });
});

describe("the reservation is a PROPORTION of the batch, not a fixed count", () => {
  it("is unchanged at the batch of five it was tuned on — 2 gaps, 3 rungs", () => {
    // The byte-identical case. A run that names no batch size gets exactly the split the campaign
    // evidence in lane-reservation.ts argues for.
    expect(gapSlotsAtGreen(5)).toBe(GAP_SLOTS_AT_GREEN);
    expect(reserveCraftSlots(gaps(5), rungs(5), 5).map((i) => i.id)).toEqual(["g1", "g2", "c1", "c2", "c3"]);
  });

  it("scales with a larger batch instead of handing the ladder everything", () => {
    // The defect a fixed 2 would have: a batch of ten would spend EIGHT slots on craft on a repo that
    // still has ten open gaps ranked above them.
    expect(gapSlotsAtGreen(10)).toBe(4);
    const out = reserveCraftSlots(gaps(10), rungs(10), 10);
    expect(out.filter((i) => i.kind !== "craft")).toHaveLength(4);
    expect(out.filter((i) => i.kind === "craft")).toHaveLength(6);
    expect(out.slice(0, 4).every((i) => i.kind !== "craft")).toBe(true); // gaps still win the top slots
  });

  it("keeps at least one of each on a batch of two — the rounding direction is the rule", () => {
    expect(gapSlotsAtGreen(2)).toBe(1);
    expect(reserveCraftSlots(gaps(5), rungs(5), 2).map((i) => i.id)).toEqual(["g1", "c1"]);
  });

  it("gives the single slot of a batch of one to a GAP — gaps outrank craft, always", () => {
    expect(gapSlotsAtGreen(1)).toBe(1);
    expect(reserveCraftSlots(gaps(5), rungs(5), 1).map((i) => i.id)).toEqual(["g1"]);
  });

  it("never degenerates on any size up to the cap", () => {
    for (let n = 2; n <= 12; n += 1) {
      expect(gapSlotsAtGreen(n), `batch ${n} left no gap slot`).toBeGreaterThanOrEqual(1);
      expect(n - gapSlotsAtGreen(n), `batch ${n} left no craft slot`).toBeGreaterThanOrEqual(1);
    }
  });
});
