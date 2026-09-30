import { describe, expect, it } from "vitest";
import { stageMark } from "./stageMark";
import { coherenceLadderSteps } from "./foundation/coherenceLadder";
import { coherenceSpread } from "./foundation/coherenceSpread";
import { foundationBackMark, foundationConformanceMark, foundationPrMark } from "./foundation/foundationMarks";
import type { RepoCoherenceRow } from "./foundation/guidanceCoherenceModel";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";

const coherence = (name: string, score: number | null): RepoCoherenceRow => ({
  fullName: name,
  name: name.split("/")[1] ?? name,
  assessed: score != null,
  coherence: score,
  documents: score == null ? 0 : 1,
  canonical: null,
  canonicalBasis: null,
  projections: [],
  contradictions: [],
  penalties: [],
  verdict: "Consistent",
});

const foundation = (over: Partial<FoundationRolloutRow> = {}): FoundationRolloutRow => ({
  repo: "acme/app",
  foundationPrAt: null,
  reportBackAt: null,
  conformance: null,
  conformanceAt: null,
  ...over,
});

describe("stageMark", () => {
  it("keeps a measured score beside met, and landed when there is no number", () => {
    expect(stageMark({ state: "measured", score: 40 })).toEqual({ state: "met", word: "met", score: 40 });
    expect(stageMark({ state: "measured" })).toEqual({ state: "met", word: "landed", score: null });
  });

  it("treats declared as partial, missing as missing, and unknown as not measured", () => {
    expect(stageMark({ state: "declared", score: 12 }).state).toBe("partial");
    expect(stageMark({ state: "missing" })).toMatchObject({ state: "missing", word: "missing", score: null });
    expect(stageMark({ state: "not-judged", score: 0 })).toEqual({ state: "unmeasured", word: "not measured", score: null });
    expect(stageMark(undefined).word).toBe("not measured");
  });
});

describe("coherenceLadderSteps", () => {
  it("puts each measured quantile in paper as a reached step", () => {
    const steps = coherenceLadderSteps(coherenceSpread([coherence("o/a", 40), coherence("o/b", 80)]));
    expect(steps.map((s) => s.detail)).toEqual(["Minimum", "Lower quartile", "Median", "Upper quartile", "Maximum"]);
    expect(steps.every((s) => s.state === "reached")).toBe(true);
    expect(steps[0]?.label).toBe("40");
    expect(steps[4]?.label).toBe("80");
  });

  it("hatches unassessed repos and draws nothing below two scores", () => {
    const steps = coherenceLadderSteps(coherenceSpread([coherence("o/a", 40), coherence("o/b", 80), coherence("o/c", null)]));
    expect(steps.at(-1)).toMatchObject({ state: "unmeasured", label: "Not assessed", detail: "1 excluded" });
    expect(coherenceLadderSteps(coherenceSpread([coherence("o/a", 40)]))).toEqual([]);
  });
});

describe("foundationMarks", () => {
  it("does not call an unopened PR missing, and does not call a missing report a zero", () => {
    expect(foundationPrMark(foundation())).toEqual({ state: "unmeasured", word: "No Ascent PR" });
    expect(foundationBackMark(foundation())).toEqual({ state: "missing", word: "Not provisioned" });
    expect(foundationConformanceMark(foundation())).toEqual({ state: "unmeasured", word: "not measured" });
  });

  it("marks a draft PR partial and a reported percent as reported", () => {
    const row = foundation({ foundationPrAt: "2026-08-01T00:00:00.000Z", reportBackAt: "2026-08-02T00:00:00.000Z", conformance: 0 });
    expect(foundationPrMark(row).state).toBe("partial");
    expect(foundationBackMark(row)).toEqual({ state: "met", word: "Provisioned" });
    expect(foundationConformanceMark(row)).toEqual({ state: "met", word: "reported" });
  });
});
