// UAT DANA-L1-001 (recurrence 3) / MC-B1 — the board PDF is the artifact with the org's name on
// it, and it was the one printing "Trajectory: Climbing at +35/wk" off two scan days with its hedge
// deleted rather than replaced, while Delivery refused the same claim one click away. Split out of
// briefing-document.test.tsx under the 300-LOC .tsx rule.
import { describe, it, expect } from "vitest";
import { text, briefing } from "./briefing-document.test-helpers";

describe("BriefingDocument — a trajectory never prints without its basis", () => {
  it("prints the basis and the confidence under a headline it is willing to state", () => {
    const t = text(
      briefing({
        forecastHeadline: "On track to reach L4 · Optimizing in ~8 weeks (≈ 2026-09-20).",
        forecastConfidence: 34,
        forecastBasis: "fit over 9 scan days across 84 days",
      }),
    );
    expect(t).toContain("On track to reach L4");
    expect(t).toContain("trend confidence 34% · noisy · fit over 9 scan days across 84 days");
  });

  it("prints the REFUSAL — in Delivery's words — instead of a slope the fit cannot support", () => {
    const t = text(
      briefing({
        forecastHeadline: null,
        forecastConfidence: null,
        forecastInsufficiency: "Not enough history to project: 2 distinct scan days (a line through ≤ 2 points fits perfectly no matter how noisy the data).",
      }),
    );
    expect(t).toContain("Not enough history to project: 2 distinct scan days");
    expect(t).not.toContain("/wk");
  });

  it("says nothing about a trajectory when there is no fit at all — absence, not fabrication (G4)", () => {
    const t = text(briefing({ forecastHeadline: null, forecastConfidence: null, forecastInsufficiency: null }));
    expect(t).not.toContain("Trajectory");
    expect(t).not.toContain("trend confidence");
  });
});

