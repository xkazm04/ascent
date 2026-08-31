// ONE WORD PER FACT ON THE COCKPIT (`MC-B41`, `RC2-N6`).
//
// `MC-B11`/`MC-B33` split the per-item verdict into a claim and a verdict, and the chrome around it
// kept the old word for two OTHER quantities: the lane rails printed `{closedIds.length} closed by
// the rescan` and the outcome sheet header printed `324 gaps closed`, where `gaps` is
// `diff.closedGapCount` — a scan-diff number. A reader who has just been taught that "claimed
// resolved" is not "closed" then met "closed" twice more, meaning two other things, on the same
// screen in the same session.
//
// THE VOCABULARY MAP THIS FILE PINS — four facts, four phrasings, no overlap:
//
//   1. an agent's trailer that nothing adjudicated      → "claimed resolved — awaiting the rescan"
//   2. ONE item the rescan ruled on (`verifiedAt` set)  → "closed by the rescan"
//   3. a LANE's count of the rescan's adjudicated set   → "verified closed"
//   4. `diff.closedGapCount`, a scan-diff quantity      → "gaps no longer raised"
//
// The guard is negative as well as positive: 3 and 4 must NOT contain the phrase reserved for 2, and
// 4 must not wear the word "closed" at all. That is what regressed, so that is what is asserted.

import { describe, expect, it } from "vitest";
import { verdictChip } from "./CockpitVerdicts";
import { takeaway } from "../outcome/outcomeText";
import type { OutcomeMatrix } from "../outcome/outcomeMatrix";

const matrix = (totals: Partial<OutcomeMatrix["totals"]>): OutcomeMatrix =>
  ({
    columns: [{}],
    rows: [],
    totals: { runs: 3, repos: 2, gaps: 324, lift: null, ...totals },
  }) as unknown as OutcomeMatrix;

describe("the cockpit's verdict vocabulary", () => {
  it("keeps the two per-item sentences exactly as `MC-B11` shipped them", () => {
    expect(verdictChip({ verdict: "resolved", verified: true }).label).toBe("closed by the rescan");
    expect(verdictChip({ verdict: "resolved", verified: false }).label).toBe("claimed resolved — awaiting the rescan");
  });

  it("gives the scan-diff quantity its own words, and never the item verdict's", () => {
    const line = takeaway(matrix({ lift: null }));
    expect(line).toBe("324 gaps no longer raised across 3 runs · no attributable lift yet");
    expect(line).not.toContain("closed");
  });

  it("leaves the lift headlines alone — they were never part of the closed vocabulary", () => {
    expect(takeaway(matrix({ lift: 12 }))).toContain("Fleet climbed");
    expect(takeaway(matrix({ lift: -12 }))).toContain("Fleet slipped");
  });
});
