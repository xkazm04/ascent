// Pins the Overview "Fix first" derivation: triage priority (regression > common gap > behind goal),
// the ungoverned nudge as filler-only, the cap at 3, and the href contracts each cell deep-links to
// (report permalink / practice anchor / plan / posture-filtered repositories).

import { describe, expect, it } from "vitest";
import { deriveFixFirst, type FixFirstInputs } from "./fixFirst";

const EMPTY: FixFirstInputs = { regressers: [], commonGaps: [], goals: [], ungovernedCount: 0 };

const FULL: FixFirstInputs = {
  regressers: [{ name: "api", fullName: "acme/api", dOverall: -9 }],
  commonGaps: [{ label: "Test discipline", weakCount: 6, total: 10, practiceId: "test-discipline" }],
  goals: [
    { label: "Reach L4", status: "active", pace: "behind" },
    { label: "Adoption 80", status: "active", pace: "on-pace" },
  ],
  ungovernedCount: 4,
};

describe("deriveFixFirst — triage order, cap, and link contracts", () => {
  it("returns [] when nothing is actionable", () => {
    expect(deriveFixFirst("acme", EMPTY)).toEqual([]);
  });

  it("orders regression > gap > goal and caps at 3 (ungoverned squeezed out)", () => {
    const items = deriveFixFirst("acme", FULL);
    expect(items.map((i) => i.key)).toEqual(["regression", "gap", "goal"]);
  });

  it("links each item to its evidence surface", () => {
    const items = deriveFixFirst("acme", FULL);
    expect(items[0]!.href).toBe("/report/acme/api");
    expect(items[1]!.href).toBe("/org/acme/practices#practice-test-discipline");
    expect(items[2]!.href).toBe("/org/acme/plan");
  });

  it("falls back to the practices index when a gap has no practiceId", () => {
    const items = deriveFixFirst("acme", { ...EMPTY, commonGaps: [{ label: "X", weakCount: 1, total: 2, practiceId: null }] });
    expect(items[0]!.href).toBe("/org/acme/practices");
  });

  it("uses the ungoverned nudge only as filler, linking to the posture-filtered repositories view", () => {
    const items = deriveFixFirst("acme", { ...EMPTY, ungovernedCount: 4 });
    expect(items.map((i) => i.key)).toEqual(["ungoverned"]);
    expect(items[0]!.href).toBe("/org/acme/repositories?posture=ungoverned");
  });

  it("ignores non-active or on-pace goals", () => {
    const items = deriveFixFirst("acme", {
      ...EMPTY,
      goals: [
        { label: "Done", status: "achieved", pace: "behind" },
        { label: "Fine", status: "active", pace: "on-pace" },
      ],
    });
    expect(items).toEqual([]);
  });

  it("picks the worst regression (regressers arrive pre-sorted most-negative-first)", () => {
    const items = deriveFixFirst("acme", {
      ...EMPTY,
      regressers: [
        { name: "worst", fullName: "acme/worst", dOverall: -12 },
        { name: "mild", fullName: "acme/mild", dOverall: -2 },
      ],
    });
    expect(items[0]!.title).toBe("Triage worst");
    expect(items[0]!.detail).toContain("12 pts");
  });

  it("threads the stack scope into org-internal links (before any #fragment, right separator)", () => {
    const items = deriveFixFirst("acme", FULL, "stack=react");
    const by = Object.fromEntries(items.map((i) => [i.key, i.href]));
    // practices already had no query → ?, and the scope goes BEFORE the #practice fragment.
    expect(by.gap).toBe("/org/acme/practices?stack=react#practice-test-discipline");
    // plan had no query → ?.
    expect(by.goal).toBe("/org/acme/plan?stack=react");
  });

  it("uses & when the internal link already has a query, and leaves the report permalink scope-free", () => {
    const items = deriveFixFirst("acme", { ...EMPTY, ...FULL, ungovernedCount: 4 }, "stack=react");
    // regression → report permalink, never scoped.
    expect(items.find((i) => i.key === "regression")!.href).toBe("/report/acme/api");
    // repositories?posture=ungoverned already has a query → & (only reachable when it makes the cut).
    const ung = deriveFixFirst("acme", { ...EMPTY, ungovernedCount: 4 }, "stack=react")[0]!;
    expect(ung.href).toBe("/org/acme/repositories?posture=ungoverned&stack=react");
  });
});
