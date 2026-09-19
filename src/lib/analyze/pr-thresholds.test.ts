// The published-rate contract: a rate must not be able to reach a reader stripped of the predicate
// that makes it true. These tests pin the structural half of that (there is no percent field to
// lift out), the floor half (a percentage that must not be published isn't), and the prose half
// (the qualifier carries the real counts, the exclusions, the channel precision and the caveat).

import { describe, it, expect } from "vitest";
import {
  FAST_APPROVAL_MAX_MINUTES,
  RATE_BASIS,
  RATE_BASIS_VERSION,
  qualifiedRate,
  rateBasisText,
  rateReading,
  ratePercent,
  type QualifiedRate,
} from "./pr-thresholds";

describe("QualifiedRate — the number cannot travel without its predicate", () => {
  it("carries no percent field, so a consumer cannot render one bare", () => {
    const rate = qualifiedRate("smallPr", 21, 34);
    // The whole point of the shape: JSON.stringify of a persisted/wire rate contains no percentage.
    const keys = Object.keys(JSON.parse(JSON.stringify(rate)) as object).sort();
    expect(keys).toEqual(["count", "defVersion", "id", "population"]);
    expect(JSON.stringify(rate)).not.toContain("62");
  });

  it("stamps the current definition version so an old rate can be told apart", () => {
    expect(qualifiedRate("smallPr", 1, 2).defVersion).toBe(RATE_BASIS_VERSION);
  });

  it("every rate id resolves to a basis with a numerator and a population", () => {
    for (const [id, basis] of Object.entries(RATE_BASIS)) {
      expect(basis.numerator, id).toBeTruthy();
      expect(basis.population, id).toBeTruthy();
    }
  });
});

describe("ratePercent — the floor travels with the number", () => {
  it("computes the percentage when the population clears the rate's floor", () => {
    expect(ratePercent(qualifiedRate("smallPr", 21, 34))).toBe(62);
    expect(ratePercent(qualifiedRate("reviewed", 4, 5))).toBe(80);
  });

  it("returns null — not 0 — under the floor, so three PRs cannot publish a share", () => {
    expect(ratePercent(qualifiedRate("selfApproved", 2, 3))).toBeNull();
    expect(ratePercent(qualifiedRate("fastApproval", 1, 4))).toBeNull();
    expect(ratePercent(qualifiedRate("reviewed", 0, 4))).toBeNull();
  });

  it("returns null on an empty population even where no explicit floor is set", () => {
    expect(ratePercent(qualifiedRate("smallPr", 0, 0))).toBeNull();
    expect(ratePercent(null)).toBeNull();
  });
});

describe("rateBasisText — what the reader is told", () => {
  it("states the counts, the population and the numerator predicate", () => {
    const text = rateBasisText(qualifiedRate("smallPr", 21, 34));
    expect(text).toContain("21 of 34 pull requests analysed in the scanned window");
    expect(text).toContain("200 changed lines");
  });

  it("names the exclusions that shape the denominator", () => {
    expect(rateBasisText(qualifiedRate("reviewed", 8, 10))).toContain("excludes bot-authored pull requests");
  });

  it("carries the per-channel precision of a multi-channel numerator", () => {
    const rate = qualifiedRate("aiInvolved", 12, 34, [
      { name: "bot author", count: 3, precision: "exact", matches: "a GitHub App login" },
      { name: "title/body/label marker", count: 9, precision: "heuristic", matches: "a bare 🤖 in the body" },
    ]);
    const text = rateBasisText(rate);
    expect(text).toContain("bot author 3 (exact:");
    expect(text).toContain("title/body/label marker 9 (heuristic:");
  });

  it("says a below-floor rate publishes no percentage, and repeats the count anyway", () => {
    const text = rateBasisText(qualifiedRate("selfApproved", 2, 3));
    expect(text).toContain("2 of 3");
    expect(text).toContain("below the 5-sample floor");
  });

  it("attaches the caveat on the signals that are read as verdicts", () => {
    expect(rateBasisText(qualifiedRate("selfApproved", 1, 10))).toContain("single-maintainer repository");
    expect(rateBasisText(qualifiedRate("fastApproval", 1, 10))).toContain("not proof of a rubber stamp");
  });

  it("warns when the rate was computed under an earlier definition", () => {
    const stale: QualifiedRate = { ...qualifiedRate("smallPr", 1, 10), defVersion: RATE_BASIS_VERSION - 1 };
    expect(rateBasisText(stale)).toContain("earlier definition");
    expect(rateBasisText(qualifiedRate("smallPr", 1, 10))).not.toContain("earlier definition");
  });
});

describe("rateReading — the figure and its qualifier arrive together", () => {
  it("hands back the percentage joined to the basis", () => {
    const r = rateReading(qualifiedRate("smallPr", 21, 34));
    expect(r.percent).toBe(62);
    expect(r.label.startsWith("62% (")).toBe(true);
    expect(r.label).toContain("of 34 pull requests analysed");
  });

  it("labels an unpublishable rate as not measurable rather than as a number", () => {
    const r = rateReading(qualifiedRate("fastApproval", 1, 3));
    expect(r.percent).toBeNull();
    expect(r.label.startsWith("not measurable —")).toBe(true);
  });
});

describe("FAST_APPROVAL_MAX_MINUTES", () => {
  it("is the 5-minute threshold the basis prose quotes", () => {
    expect(FAST_APPROVAL_MAX_MINUTES).toBe(5);
    expect(RATE_BASIS.fastApproval.numerator).toContain("5 minutes");
  });
});
