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
