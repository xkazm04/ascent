// The digest's view models — the refusals, tested without a DOM.
//
// Every case here is a shape the digest must NOT be able to draw: a delta for a dimension the window
// could not measure, a zero for an unmeasurable "opened" diff, a projection for a move that has
// none, a cohort for a week with no baseline. Each one is the same defect class the /org redesign
// found in eight surfaces (docs/features/org-dashboard/org-intelligence.md, "One rule, four places
// it was not applied"): the codebase had no way to say "unmeasured", so every surface reached for
// the nearest available value, and `0` is always available.

import { describe, expect, it } from "vitest";
import { rendersValue } from "@/components/org/viz";
import { digestFixture } from "./digest.fixture";
import { NOISE, actionBars, bandState, coverageView, deltaExtent, dimBars, ledgerView, moveMarks, presentStates } from "./digestViz";

describe("bandState", () => {
  it("maps an unmeasured band to `missing`, whose rendersValue is false", () => {
    expect(bandState("unmeasured")).toBe("missing");
    expect(rendersValue(bandState("unmeasured"))).toBe(false);
  });

  it("keeps a within-noise hold MEASURED — the band draws it, the state must not double-encode it", () => {
    expect(bandState("flat")).toBe("measured");
    expect(bandState("up")).toBe("measured");
    expect(bandState("down")).toBe("measured");
  });
});

describe("deltaExtent", () => {
  it("never draws an axis tighter than the noise band plus a margin", () => {
    expect(deltaExtent([0, 1, null])).toBe(NOISE + 2);
    expect(deltaExtent([])).toBe(NOISE + 2);
  });

  it("grows to the largest absolute move, ignoring the nulls entirely", () => {
    expect(deltaExtent([5, -9, null])).toBe(9);
  });
});

describe("dimBars", () => {
  it("drops the delta of an unmeasured dimension rather than carrying a number nothing may print", () => {
    const bars = dimBars([{ dimId: "D4", label: "Security Posture", now: 66, delta: 3, band: "unmeasured" }]);
    expect(bars[0]).toMatchObject({ delta: null, state: "missing", withinNoise: false });
  });

  it("marks a flat band as within-noise while keeping its measured delta", () => {
    const bars = dimBars(digestFixture().dims);
    expect(bars.find((b) => b.dimId === "D3")).toMatchObject({ delta: 1, state: "measured", withinNoise: true });
    expect(bars.find((b) => b.dimId === "D1")).toMatchObject({ delta: 5, withinNoise: false });
  });
});

describe("ledgerView", () => {
  const base = digestFixture().followups!;

  it("keeps dismissals in their own segment, in the kit's `decided` state", () => {
    const v = ledgerView(base);
    expect(v.dismissed).toMatchObject({ count: 2, state: "decided" });
    // The closes are exactly the closes: nothing folds the dismissals in.
    expect(v.closed.count).toBe(base.closed);
  });

  it("makes an unmeasurable `opened` a void with NO count — not a zero", () => {
    const v = ledgerView({ ...base, opened: 0, openedRows: [], openedMeasurable: false });
    expect(v.opened.count).toBeNull();
    expect(v.opened.state).toBe("missing");
    expect(rendersValue(v.opened.state)).toBe(false);
  });

  it("shares one count axis across both tracks, so the two bars stay comparable", () => {
    expect(ledgerView({ ...base, closed: 5, dismissed: 2, opened: 3 }).max).toBe(7);
    expect(ledgerView({ ...base, closed: 1, dismissed: 0, opened: 9 }).max).toBe(9);
    // never 0: an empty week still needs an axis to draw nothing on
    expect(ledgerView({ ...base, closed: 0, dismissed: 0, opened: 0 }).max).toBe(1);
  });
});

describe("actionBars", () => {
  it("voids the points of a move with no projection while keeping its measured reach", () => {
    const { bars } = actionBars(digestFixture().actions);
    const third = bars[2];
    expect(third.perRepo).toBeNull();
    expect(third.pointsState).toBe("missing");
    expect(third.repoCount).toBe(2);
  });

  it("clamps lifts to the reach, so a bad row cannot draw a segment past its own bar", () => {
    const [a] = digestFixture().actions;
    const { bars } = actionBars([{ ...a, repoCount: 2, liftsRepos: 9 }]);
    expect(bars[0].lifts).toBe(2);
  });
});

describe("coverageView", () => {
  it("nests the three populations and counts the never-scanned repositories", () => {
    const v = coverageView(digestFixture().headline);
    expect(v).toMatchObject({ total: 12, scanned: 10, cohort: 8, neverScanned: 2, cohortState: "measured" });
  });

  it("makes an absent cohort `missing`, never 0", () => {
    const h = { ...digestFixture().headline, cohortSize: null, dOverall: null, dAdoption: null, dRigor: null };
    const v = coverageView(h);
    expect(v.cohort).toBeNull();
    expect(v.cohortState).toBe("missing");
  });
});

describe("moveMarks", () => {
  it("puts gainers and slippers on one axis and flags the level crossings", () => {
    const { marks, extent } = moveMarks(digestFixture().movement!);
    expect(marks.map((m) => m.d)).toEqual([9, -7]);
    expect(marks.every((m) => m.crossedLevel)).toBe(true);
    expect(extent).toBe(9);
  });
});

describe("presentStates", () => {
  it("de-dupes in first-seen order so a legend teaches only the encodings in the data", () => {
    expect(presentStates(["measured", "missing", "measured"])).toEqual(["measured", "missing"]);
  });
});
