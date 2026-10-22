// The one table of what a recommendation status change MEANS (roadmap-0, challenge 2026-10-22b).
// Every writer that moves a status asks this; the cases below are the whole rule.

import { describe, expect, it } from "vitest";
import { planRecTransition } from "./rec-transitions";

describe("planRecTransition", () => {
  it("a close earns the memory write", () => {
    expect(planRecTransition({ from: "in_progress", to: "done", reason: null })).toEqual(["close-memory"]);
  });

  it("a dismissal WITH a reason becomes a standing decision", () => {
    expect(planRecTransition({ from: "open", to: "dismissed", reason: "we build with Bazel" })).toEqual(["standing-dismissal"]);
  });

  it("a dismissal without a reason records nothing (silence is not suppression)", () => {
    expect(planRecTransition({ from: "open", to: "dismissed", reason: null })).toEqual([]);
    expect(planRecTransition({ from: "open", to: "dismissed", reason: "  " })).toEqual([]);
    expect(planRecTransition({ from: "open", to: "dismissed" })).toEqual([]);
  });

  it("leaving dismissed lifts the standing decision", () => {
    expect(planRecTransition({ from: "dismissed", to: "open" })).toEqual(["reopen-decision"]);
  });

  it("an UNKNOWN prior state clears defensively (the clear is a no-op without a decision)", () => {
    expect(planRecTransition({ from: null, to: "in_progress" })).toEqual(["reopen-decision"]);
    expect(planRecTransition({ from: null, to: "done" })).toEqual(["close-memory", "reopen-decision"]);
  });

  it("moves that carry no consequence plan nothing", () => {
    expect(planRecTransition({ from: "open", to: "in_progress" })).toEqual([]);
    expect(planRecTransition({ from: "done", to: "done" })).toEqual([]);
    expect(planRecTransition({ from: "in_progress", to: "open" })).toEqual([]);
  });

  it("dismissed -> done closes AND lifts the standing dismissal (critic revise)", () => {
    expect(planRecTransition({ from: "dismissed", to: "done" })).toEqual(["close-memory", "reopen-decision"]);
  });

  it("a re-dismissal with a new reason re-records it; without one it changes nothing", () => {
    expect(planRecTransition({ from: "dismissed", to: "dismissed", reason: "moved to Nx" })).toEqual(["standing-dismissal"]);
    expect(planRecTransition({ from: "dismissed", to: "dismissed", reason: null })).toEqual([]);
  });
});
