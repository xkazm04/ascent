// Regression test for G3-09: buildFallbackRoadmap must rank + cite the BLENDED score (the one the
// report headline/dimension cards actually show), not the pre-blend `signalScore`, when a blended
// score is supplied. Existing callers that don't supply one (the mock provider, which has no
// separate blend) keep ranking on signalScore unchanged.

import { describe, it, expect } from "vitest";
import { buildFallbackRoadmap } from "./recommendations";
import type { DimensionSignals } from "@/lib/types";

function signals(overrides: Partial<Record<string, number>>): DimensionSignals[] {
  const ids = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"] as const;
  return ids.map((id) => ({ id, signalScore: overrides[id] ?? 50, signals: [] }));
}

describe("buildFallbackRoadmap — backward compatible without a blended score (mock provider path)", () => {
  it("ranks and cites raw signalScore when no blended scores are supplied", () => {
    const s = signals({ D9: 10 }); // D9 has the lowest raw signal and high catalog weight -> top gap
    const roadmap = buildFallbackRoadmap(s, 50, "org");
    expect(roadmap[0]!.dimension).toBe("D9");
    expect(roadmap[0]!.rationale).toContain("scored 10/100");
  });
});

describe("buildFallbackRoadmap — ranks/cites the blended score when supplied (G3-09)", () => {
  it("a dimension the blend lifted well above its raw signal is no longer mis-ranked as the #1 gap", () => {
    // Raw signal: D9=10 (all others 50) makes D9 the #1 gap by weighted upside under the org lens
    // (0.09*90=8.1 > D1/D2's 0.15*50=7.5 > D3's 0.14*50=7.1).
    const s = signals({ D9: 10 });
    const rawRoadmap = buildFallbackRoadmap(s, 50, "org");
    expect(rawRoadmap[0]!.dimension).toBe("D9");

    // The LLM blend lifted D9 to 90 (guardband-limited nuance) — the report headline/dimension cards
    // show THIS number, not the raw 10 above. Its real (blended) gap (0.09*10=0.9) no longer beats
    // D1/D2/D3, so it must drop out of the top-3 entirely rather than still being cited as the #1 gap
    // with a rationale quoting "scored 10/100" next to a dimension the report shows scoring 90.
    const blended = [{ id: "D9" as const, score: 90 }];
    const blendedRoadmap = buildFallbackRoadmap(s, 50, "org", blended);
    expect(blendedRoadmap.find((r) => r.dimension === "D9")).toBeUndefined();
    expect(blendedRoadmap.map((r) => r.dimension)).toEqual(["D1", "D2", "D3"]);
  });

  it("falls back to signalScore for an id missing from the blended list", () => {
    const s = signals({ D9: 10 });
    const roadmap = buildFallbackRoadmap(s, 50, "org", [{ id: "D1" as const, score: 99 }]); // D9 not included
    const d9 = roadmap.find((r) => r.dimension === "D9")!;
    expect(d9.rationale).toContain("scored 10/100"); // falls back to raw signalScore
  });
});

// The follow-up GUARANTEE (buildDimensionFollowUps): every dimension below FOLLOW_UP_BELOW carries a
// roadmap entry. The failure this pins: the prompt asks for 3-5 entries over 9 dimensions, so most
// scans left below-green dimensions with an empty "Next steps" — and the drill-in read that emptiness
// as "not a gap". An empty follow-up list on a 40 is a verdict, so it must be impossible.
import { buildDimensionFollowUps } from "./recommendations";
import { FOLLOW_UP_BELOW } from "@/lib/maturity/model";

const item = (dimension: string, title = `model:${dimension}`) => ({
  title,
  dimension: dimension as "D1",
  impact: "high" as const,
  effort: "low" as const,
  rationale: "r",
  explore: ["q?"],
});

describe("buildDimensionFollowUps — the follow-up guarantee", () => {
  it("leaves a fully-covered roadmap byte-identical", () => {
    const roadmap = [item("D2"), item("D5")];
    const dims = [
      { id: "D2" as const, score: 30 },
      { id: "D5" as const, score: 40 },
      { id: "D1" as const, score: 80 }, // green — nothing owed
    ];
    expect(buildDimensionFollowUps(roadmap, dims, 50)).toBe(roadmap);
  });

  it("appends an entry for every below-green dimension the model skipped, lowest score first", () => {
    const roadmap = [item("D2")];
    const dims = [
      { id: "D2" as const, score: 30 },
      { id: "D1" as const, score: 50 },
      { id: "D9" as const, score: 20 },
      { id: "D3" as const, score: FOLLOW_UP_BELOW }, // exactly on the floor: green, not owed
    ];
    const out = buildDimensionFollowUps(roadmap, dims, 45);
    // model entry first, untouched
    expect(out[0]).toBe(roadmap[0]);
    // then the uncovered ones, ascending by score: D9 (20) before D1 (50)
    expect(out.slice(1).map((r) => r.dimension)).toEqual(["D9", "D1"]);
    // the floor itself is green — D3 gets nothing
    expect(out.some((r) => r.dimension === "D3")).toBe(false);
  });

  // Grounded in the scan's OWN finding when there is one: the drill-in should show what THIS repo
  // is missing, not a generic template — the template is the fallback, not the default.
  it("titles a synthesised entry with the dimension's first gap, falling back to the catalog", () => {
    const dims = [
      { id: "D2" as const, score: 30, gaps: ["  ", "No visible coverage threshold fails a run"] },
      { id: "D5" as const, score: 30, gaps: [] },
    ];
    const out = buildDimensionFollowUps([], dims, 30);
    const d2 = out.find((r) => r.dimension === "D2")!;
    const d5 = out.find((r) => r.dimension === "D5")!;
    expect(d2.title).toBe("No visible coverage threshold fails a run"); // blank first gap skipped
    expect(d5.title.length).toBeGreaterThan(0); // catalog template
    expect(d5.title).not.toContain("undefined");
    // the rationale names the score and the band it is below, so the entry explains itself
    expect(d2.rationale).toContain("scored 30/100");
    expect(d2.rationale).toContain(String(FOLLOW_UP_BELOW));
  });

  it("carries the invitational explore questions and a level unlock on synthesised entries", () => {
    const out = buildDimensionFollowUps([], [{ id: "D4" as const, score: 10 }], 30);
    expect(out[0]!.explore.length).toBeGreaterThan(0);
    expect(out[0]!.levelUnlock).toBe("L2->L3");
  });
});
