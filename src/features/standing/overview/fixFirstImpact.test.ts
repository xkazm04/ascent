// Pins the "Fix first" band's impact model — and, above everything, pins that the two candidates
// with no scoring model behind them can never acquire a number.
//
// The band draws three bars on one shared scale. The risk a shared scale introduces is that an
// UNMEASURED candidate reads as a measured zero: the findings queue, which is the most action-shaped
// thing on the page, would rank last on a scale it was never measured on. `state: "missing"` plus
// `rendersValue` is what makes that structurally impossible, so these tests assert the state and the
// null gain, not the bar's pixels.

import { describe, expect, it } from "vitest";
import { rendersValue } from "@/components/org/viz";
import {
  findingImpact,
  goalImpact,
  impactScaleMax,
  regressionImpact,
  type FixFirstImpact,
} from "@/features/standing/overview/fixFirstImpact";
import { deriveFixFirst, type FixFirstInputs } from "@/features/standing/overview/fixFirst";

describe("regressionImpact — a repo's loss, divided before it reaches a fleet scale", () => {
  it("divides the lost points across the compared population", () => {
    const i = regressionImpact("api", -9, 45);
    expect(i.state).toBe("measured");
    expect(i.gain).toBe(0.2);
    expect(i.basis).toContain("45 repositories");
  });

  it("reads the magnitude, not the sign", () => {
    expect(regressionImpact("api", -9, 45).gain).toBe(regressionImpact("api", 9, 45).gain);
  });

  it("is a VOID, never an undivided 9, when no repo has a baseline on both sides", () => {
    // The failure this forbids: printing the repo's own 9-point drop on a scale labelled "fleet
    // points", which overstates it by the size of the fleet.
    const i = regressionImpact("api", -9, 0);
    expect(i.state).toBe("missing");
    expect(i.gain).toBeNull();
    expect(rendersValue(i.state)).toBe(false);
  });

  it("is a void when there is no measured drop at all", () => {
    expect(regressionImpact("api", 0, 45).state).toBe("missing");
  });
});

describe("findingImpact — the unmeasured candidate", () => {
  it("is ALWAYS missing, so the bar can have no length rather than a length of zero", () => {
    for (const n of [1, 3, 40]) {
      const i = findingImpact(n, "security");
      expect(i.state).toBe("missing");
      expect(i.gain).toBeNull();
      expect(rendersValue(i.state)).toBe(false);
    }
  });

  it("says in one sentence why, and pluralises the count", () => {
    expect(findingImpact(1, "security").basis).toContain("1 security finding await");
    expect(findingImpact(3, "security").basis).toContain("3 security findings await");
    expect(findingImpact(3, "security").basis).toContain("no length rather than a length of zero");
  });
});

describe("goalImpact — remaining distance on a fleet metric", () => {
  it("is the gap to target, in the metric's own points", () => {
    const i = goalImpact({ label: "Reach L4", metricLabel: "Overall maturity", target: 70, current: 58 });
    expect(i.state).toBe("measured");
    expect(i.gain).toBe(12);
    expect(i.basis).toContain("Overall maturity");
  });

  it("is a void when the goal carries no readable standing", () => {
    expect(goalImpact({ label: "Reach L4" }).state).toBe("missing");
    expect(goalImpact({ label: "Reach L4", target: 70 }).gain).toBeNull();
  });

  it("is a void — never a negative or zero bar — for a goal already at its target", () => {
    const i = goalImpact({ label: "Reach L4", target: 70, current: 74 });
    expect(i.state).toBe("missing");
    expect(i.gain).toBeNull();
  });
});

describe("impactScaleMax — the shared upper bound", () => {
  const measured = (gain: number): FixFirstImpact => ({ gain, state: "measured", basis: "" });
  const void_ = (): FixFirstImpact => ({ gain: null, state: "missing", basis: "" });

  it("is the largest computable gain", () => {
    expect(impactScaleMax([measured(0.2), void_(), measured(12)])).toBe(12);
  });

  it("is null — not 0 — when nothing in the band was computable", () => {
    // A max of 0 would divide by zero downstream; a null max means every bar is a void, which is a
    // true reading of a fleet with no measurable baseline.
    expect(impactScaleMax([void_(), void_()])).toBeNull();
    expect(impactScaleMax([])).toBeNull();
  });

  it("ignores a non-finite gain that somehow reached a measured state", () => {
    expect(impactScaleMax([{ gain: Number.NaN, state: "measured", basis: "" }, measured(3)])).toBe(3);
  });
});

describe("deriveFixFirst attaches an impact to every item", () => {
  const inputs: FixFirstInputs = {
    regressers: [{ name: "api", fullName: "acme/api", dOverall: -9 }],
    findings: [{ module: "security", repo: "acme/api", title: "Default branch is unprotected" }],
    goals: [{ label: "Reach L4", status: "active", pace: "behind", metricLabel: "Overall maturity", target: 70, current: 58 }],
    comparedRepos: 45,
  };

  it("gives each triage slot a bar or a stated absence", () => {
    const items = deriveFixFirst("acme", inputs);
    expect(items.map((i) => i.impact.state)).toEqual(["measured", "missing", "measured"]);
    expect(items.map((i) => i.impact.gain)).toEqual([0.2, null, 12]);
  });

  it("keeps TRIAGE order even though the goal's bar is sixty times the regression's", () => {
    // The numerals are precedence, not magnitude — an item with no bar at all must not sort last.
    expect(deriveFixFirst("acme", inputs).map((i) => i.key)).toEqual(["regression", "finding", "goal"]);
  });

  it("voids the regression bar when the movers read failed and comparedRepos is absent", () => {
    const rest: FixFirstInputs = { regressers: inputs.regressers, findings: inputs.findings, goals: inputs.goals };
    expect(deriveFixFirst("acme", rest)[0]!.impact.state).toBe("missing");
  });
});
