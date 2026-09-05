// REPORT-OR-ABSORB, tested as the rule it is.
//
// The interesting assertions here are the NEGATIVE ones, and they are the whole point of the module:
// an absorbed outcome must be countable and must be structurally incapable of reaching a message. A
// test that only checked "the important thing is raised" would pass on an implementation that raised
// everything and sorted it.

import { describe, it, expect } from "vitest";
import {
  absorbedTally,
  composeCycleMessage,
  judgeCycleOutcome,
  partitionCycleOutcomes,
  summarizeCycle,
  type CycleOutcome,
} from "./cycle-signal";

const outcome = (o: Partial<CycleOutcome> & { id: string }): CycleOutcome => ({
  kind: "briefing",
  text: "something",
  ...o,
});

describe("the bar", () => {
  it("absorbs an outcome with nothing to say", () => {
    expect(judgeCycleOutcome(outcome({ id: "a", text: "   " }))).toEqual({
      report: false,
      reason: "nothing_to_say",
    });
  });

  it("absorbs maintenance ABSOLUTELY — even when it moved a number", () => {
    // The rule that makes the doctrine real: a consolidation that happens to carry a large delta is
    // still housekeeping she is supposed to handle quietly.
    expect(judgeCycleOutcome(outcome({ id: "a", kind: "consolidation", delta: 40 }))).toEqual({
      report: false,
      reason: "maintenance",
    });
    expect(judgeCycleOutcome(outcome({ id: "b", kind: "housekeeping", decision: "x" }))).toEqual({
      report: false,
      reason: "maintenance",
    });
  });

  it("reports a decision waiting on a human", () => {
    expect(judgeCycleOutcome(outcome({ id: "a", kind: "proposal", decision: "rule_on_finding" }))).toEqual({
      report: true,
      reason: "decision_waiting",
    });
  });

  it("reports movement beyond the org's noise band, and absorbs movement inside it", () => {
    expect(judgeCycleOutcome(outcome({ id: "a", delta: 6 })).report).toBe(true);
    expect(judgeCycleOutcome(outcome({ id: "b", delta: -6 })).report).toBe(true);
    // SCORE_NOISE_BAND is 2: a +1 is scan-to-scan wobble, not news.
    expect(judgeCycleOutcome(outcome({ id: "c", delta: 1 }))).toEqual({ report: false, reason: "within_noise" });
    expect(judgeCycleOutcome(outcome({ id: "d", delta: 0 }))).toEqual({ report: false, reason: "within_noise" });
  });

  it("absorbs a restatement of what the dashboard already shows", () => {
    expect(judgeCycleOutcome(outcome({ id: "a", alreadyVisible: true }))).toEqual({
      report: false,
      reason: "already_visible",
    });
  });
});

describe("an absorbed outcome cannot reach a message", () => {
  it("drops the prose entirely — there is nothing left to render", () => {
    const { absorbed } = partitionCycleOutcomes([
      outcome({ id: "c1", kind: "consolidation", text: "Folded 6 memories together." }),
    ]);
    expect(absorbed).toEqual([{ id: "c1", kind: "consolidation", reason: "maintenance" }]);
    expect(JSON.stringify(absorbed)).not.toContain("Folded");
  });

  it("six consolidations and one thing that matters: the six are not in the message", () => {
    const outcomes: CycleOutcome[] = [
      outcome({ id: "briefing", text: "D9 slid 7 points on acme/api after the CI change.", delta: -7 }),
      ...Array.from({ length: 6 }, (_, i) =>
        outcome({ id: `c${i}`, kind: "consolidation", text: `Consolidated batch ${i}.` }),
      ),
    ];
    const part = partitionCycleOutcomes(outcomes);
    expect(part.raised).toHaveLength(1);
    expect(part.absorbed).toHaveLength(6);
    const message = composeCycleMessage(part.raised);
    expect(message).toBe("D9 slid 7 points on acme/api after the CI change.");
    expect(message).not.toContain("Consolidated");
    // And no count of them either — a trailing "and 6 routine items" is the same lesson to skip.
    expect(message).not.toContain("6");
  });

  it("counts absorbed outcomes by reason so they stay inspectable", () => {
    const { absorbed } = partitionCycleOutcomes([
      outcome({ id: "a", kind: "consolidation" }),
      outcome({ id: "b", kind: "housekeeping" }),
      outcome({ id: "c", delta: 1 }),
    ]);
    expect(absorbedTally(absorbed)).toEqual({ maintenance: 2, within_noise: 1 });
  });
});

describe("silence is a first-class result", () => {
  it("composes null when nothing cleared the bar — never a 'nothing to report' note", () => {
    const part = partitionCycleOutcomes([
      outcome({ id: "a", text: "The fleet is stable.", alreadyVisible: true }),
      outcome({ id: "b", kind: "consolidation" }),
    ]);
    expect(part.raised).toHaveLength(0);
    expect(composeCycleMessage(part.raised)).toBeNull();
  });

  it("composes null for an empty raised list", () => {
    expect(composeCycleMessage([])).toBeNull();
  });
});

describe("promotion: a raised decision brings the prose that explains it", () => {
  it("promotes an otherwise-absorbed briefing when a proposal is raised", () => {
    const part = partitionCycleOutcomes([
      outcome({ id: "briefing", text: "Two follow-ups have been open for a fortnight.", delta: 1 }),
      outcome({ id: "action:handoff_followups", kind: "proposal", text: "Claim 2 follow-up items", decision: "handoff_followups" }),
    ]);
    expect(part.raised.map((o) => o.id)).toEqual(["briefing", "action:handoff_followups"]);
    expect(part.absorbed).toHaveLength(0);
    // An Accept button under nothing is what the store's transaction exists to prevent; the prose
    // must travel with the card.
    expect(composeCycleMessage(part.raised)).toContain("Two follow-ups");
  });

  it("never promotes maintenance, whatever else was raised", () => {
    const part = partitionCycleOutcomes([
      outcome({ id: "c", kind: "consolidation", text: "Folded memories." }),
      outcome({ id: "action:x", kind: "proposal", text: "Do a thing", decision: "x" }),
    ]);
    expect(part.raised.map((o) => o.id)).toEqual(["action:x"]);
    expect(part.absorbed.map((a) => a.reason)).toEqual(["maintenance"]);
  });

  it("never promotes a briefing that has no prose", () => {
    const part = partitionCycleOutcomes([
      outcome({ id: "briefing", text: "" }),
      outcome({ id: "action:x", kind: "proposal", text: "Do a thing", decision: "x" }),
    ]);
    expect(part.raised.map((o) => o.id)).toEqual(["action:x"]);
  });

  it("does not promote a briefing when nothing else was raised", () => {
    const part = partitionCycleOutcomes([outcome({ id: "briefing", text: "All steady.", delta: 0 })]);
    expect(part.raised).toHaveLength(0);
  });
});

describe("her own episode may say what a message may not", () => {
  it("names the absorbed count and reasons — memory is not contact", () => {
    const part = partitionCycleOutcomes([
      outcome({ id: "briefing", text: "Steady.", delta: 0 }),
      outcome({ id: "c", kind: "consolidation" }),
    ]);
    const line = summarizeCycle(part, false);
    expect(line).toContain("raised nothing");
    expect(line).toContain("Absorbed 2");
    expect(line).toContain("within_noise");
  });
});
