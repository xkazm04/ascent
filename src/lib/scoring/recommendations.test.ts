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
    // D1 (0.15*50=7.50, low effort ×1.0 = 7.50), D3 (0.14*50=7.00, low ×1.0 = 7.00),
    // D2 (0.15*50=7.50, MEDIUM ×0.9 = 6.75). D3 now precedes D2: two near-identical upsides, and the
    // cheaper one is the honest "do this first". Before the effort term this read ["D1","D2","D3"].
    expect(blendedRoadmap.map((r) => r.dimension)).toEqual(["D1", "D3", "D2"]);
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

// Item 25 (`effort-not-in-sort-key`): priority is weight x headroom x EFFORT. Effort used to be
// carried to display only, so the roadmap could open with the most expensive item on the board.
describe("buildFallbackRoadmap - effort is part of the ranking, gently", () => {
  it("puts the cheaper of two comparable gaps first", () => {
    // Equal scores everywhere: D2 (weight .15, effort medium) vs D3 (weight .14, effort low). On
    // weight x headroom alone D2 leads (7.50 > 7.00); with the effort discount D2 is 6.75 and the
    // low-effort D3 leads. That is the whole point: near-identical upside, materially different cost.
    const roadmap = buildFallbackRoadmap(signals({ D1: 100, D9: 100 }), 50, "org");
    const dims = roadmap.map((r) => r.dimension);
    expect(dims.indexOf("D3")).toBeLessThan(dims.indexOf("D2"));
  });

  it("still leads with a dominant high-effort gap - the discount is 10% per rank, not a division", () => {
    // D2 (tests, effort medium) at 0 vs D3 (CI, effort low) at 50: 0.15*100*0.9 = 13.5 beats
    // 0.14*50*1.0 = 7.0 by far more than the discount can bridge. A genuinely dominant gap must not
    // be pushed off the list by cheapness, or the roadmap becomes a chore list.
    const roadmap = buildFallbackRoadmap(signals({ D2: 0 }), 50, "org");
    expect(roadmap[0]!.dimension).toBe("D2");
  });
});

// Item 40 (`framing-rules-unenforced`): the invitational-framing rules are lintable, deterministic,
// and reported rather than applied. The hand-reviewed catalog is the positive fixture set.
import { lintRoadmapFraming } from "./recommendations";

const framed = (title: string, rationale = "Some grounded reason.") => ({
  title,
  dimension: "D1" as const,
  rationale,
});

describe("lintRoadmapFraming - the framing rules, enforced", () => {
  it("passes every entry the catalog produces (the hand-reviewed positive fixtures)", () => {
    // Every catalog title + rationale, via the two builders that emit them.
    const fallback = buildFallbackRoadmap(signals({}), 50, "org");
    const followUps = buildDimensionFollowUps(
      [],
      (["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"] as const).map((id) => ({ id, score: 10 })),
      30,
    );
    expect(lintRoadmapFraming([...fallback, ...followUps])).toEqual([]);
  });

  it("flags a title that opens with a bare imperative", () => {
    const v = lintRoadmapFraming([framed("Add a CI gate to every pull request")]);
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("imperative-title");
  });

  it("does not flag a mid-sentence verb - only the opening word is an order", () => {
    expect(lintRoadmapFraming([framed("Few tests vouch for behavior: little catches a bad change")])).toEqual([]);
  });

  it("flags supervisory phrasing in the title or the rationale", () => {
    const title = lintRoadmapFraming([framed("You must fix the missing CI gate")]);
    expect(title.map((x) => x.rule)).toContain("supervisory-tone");
    const rationale = lintRoadmapFraming([framed("Little gates what reaches main", "Make sure a check runs.")]);
    expect(rationale.map((x) => x.rule)).toContain("supervisory-tone");
  });

  it("flags a title that contradicts its own rationale", () => {
    const v = lintRoadmapFraming([
      framed("No tests vouch for behavior", "Coverage here is already in place across the suite."),
    ]);
    expect(v.map((x) => x.rule)).toContain("title-contradicts-rationale");
  });

  it("records the violation and leaves the entry untouched - never rewritten, never dropped", () => {
    const offending = {
      title: "Add a CI gate",
      dimension: "D3" as const,
      impact: "high" as const,
      effort: "low" as const,
      rationale: "r",
      explore: ["q?"],
    };
    const out = buildDimensionFollowUps([offending], [{ id: "D3" as const, score: 20 }], 30);
    // The model's entry ships byte-identical (D3 is covered, so nothing is appended either).
    expect(out[0]).toBe(offending);
    expect(lintRoadmapFraming(out)).toHaveLength(1);
  });
});
