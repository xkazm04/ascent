// @vitest-environment jsdom
//
// The HTML briefing blocks, pinned at the RENDER layer.
//
// Direction 1: the headline tiles must land on their NO-SCORE path when nothing in the fleet was
// live-scored. `getOrgRollup` returns 0 for `avgOverall` at that denominator as a division guard,
// and the tiles rendered it as a grade with an "L1" caption beside it — a claim about a fleet that
// had never been measured, in the largest type on the page.
//
// Direction 2 (below): the same blocks must read their sentences from the ONE composer in
// briefing.ts rather than hand-rolling them, which is how "— / vs 1 repos" survived in a headline
// tile after the identical copy had been fixed in the PDF.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BriefingTiles } from "./briefingCards";
import { BriefingBasisNote } from "./BriefingBasisNote";
import type { ExecBriefing } from "@/lib/org/briefing";

const MATURITY: ExecBriefing["maturity"] = { overall: 62, levelId: "L3", levelName: "Managed", adoption: 58, rigor: 66 };
const UNMEASURED: ExecBriefing["maturity"] = { overall: 0, levelId: "L1", levelName: "Ad hoc", adoption: 0, rigor: 0 };

function briefing(over: Partial<ExecBriefing> = {}): ExecBriefing {
  return {
    org: "acme",
    periodTitle: "last 90 days",
    generatedOn: "2026-09-05",
    maturity: MATURITY,
    coverage: { scanned: 8, total: 12 },
    realScoredCount: 8,
    mockCount: 0,
    periodDelta: null,
    priorPeriod: null,
    forecastHeadline: null,
    forecastConfidence: null,
    engineMix: [],
    adoptionRate: null,
    movement: { up: 0, down: 0, compared: 0 },
    valueRealized: { recsEngaged: 0, recsActioned: 0, pointsMoved: null, reposPromoted: 0 },
    benchmark: null,
    strengths: [],
    risks: [],
    security: null,
    topGainers: [],
    topRegressions: [],
    goals: [],
    regressionCount: 0,
    ...over,
  };
}

describe("BriefingTiles — the no-score path (Direction 1)", () => {
  it("prints the averages when there IS a live-scored denominator", () => {
    render(<BriefingTiles maturity={MATURITY} benchmark={null} realScoredCount={8} />);
    expect(screen.getByText("62")).toBeTruthy();
    expect(screen.getByText("L3 · Managed")).toBeTruthy();
  });

  it("prints em dashes and a REASON — never a 0 that reads as a grade, never L1", () => {
    const { container } = render(<BriefingTiles maturity={UNMEASURED} benchmark={null} realScoredCount={0} delta={4} deltaLabel="vs last 90 days" />);
    expect(screen.getByText("no live-scored repositories")).toBeTruthy();
    expect(screen.queryByText("L1 · Ad hoc")).toBeNull();
    // Three maturity tiles show "—". (The percentile tile shows one too — four in total here.)
    expect(container.textContent).not.toMatch(/\b0\b/);
    // The period delta is suppressed with the score it was a delta OF: +4 against a division guard
    // is not movement.
    expect(container.textContent).not.toContain("vs last 90 days");
  });
});

describe("BriefingBasisNote — coverage and score basis are two different denominators", () => {
  it("states both on a mixed fleet", () => {
    const { container } = render(<BriefingBasisNote briefing={briefing({ realScoredCount: 6, mockCount: 2 })} />);
    expect(container.textContent).toContain("Coverage: 8/12 repositories scanned");
    expect(container.textContent).toContain("averaged over 6 live-scored repositories");
  });

  it("replaces the basis with the no-score sentence, keeping coverage in full (G1)", () => {
    const { container } = render(<BriefingBasisNote briefing={briefing({ maturity: UNMEASURED, realScoredCount: 0, mockCount: 8 })} />);
    expect(container.textContent).toContain("Coverage: 8/12 repositories scanned");
    expect(container.textContent).not.toContain("averaged over");
    expect(container.textContent).toContain("No live-scored repositories in this period");
  });
});
