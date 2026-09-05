import { describe, expect, it } from "vitest";
import {
  aggregateLift,
  liftKey,
  OUTCOME_MIN_ORGS,
  OUTCOME_MIN_SAMPLES,
  type OutcomeSample,
} from "@/lib/outcomes/aggregate";

const sample = (over: Partial<OutcomeSample> = {}): OutcomeSample => ({
  orgId: "org_1",
  identityKey: "adr-log",
  dimId: "D2",
  overallDelta: 4,
  dimDelta: 11,
  rubricVersion: "r10",
  engineProvider: "claude",
  isPrivateRepo: false,
  ...over,
});

const key = (over: Partial<OutcomeSample> = {}) => {
  const s = sample(over);
  return liftKey(s.identityKey, s.dimId, { rubricVersion: s.rubricVersion, engineProvider: s.engineProvider });
};

describe("aggregateLift — floors (a partition below the floor is ABSENT, never nulled)", () => {
  it("org scope: two samples yield no key at all", () => {
    const out = aggregateLift([sample({ orgId: "o1" }), sample({ orgId: "o2" })], { scope: "org" });
    expect(out.size).toBe(0);
    expect(out.has(key())).toBe(false);
  });

  it("org scope: the third sample publishes the partition", () => {
    const rows = Array.from({ length: OUTCOME_MIN_SAMPLES }, () => sample());
    const out = aggregateLift(rows, { scope: "org" });
    expect(out.get(key())?.n).toBe(OUTCOME_MIN_SAMPLES);
  });

  it("corpus scope: four DISTINCT orgs are below the cohort floor and yield an absent key", () => {
    const rows = ["o1", "o2", "o3", "o4"].map((orgId) => sample({ orgId }));
    expect(rows.length).toBeGreaterThanOrEqual(OUTCOME_MIN_SAMPLES); // the sample floor is met
    const out = aggregateLift(rows, { scope: "corpus" });
    expect(out.size).toBe(0);
  });

  it("corpus scope: the fifth org publishes it, and `orgs` is the distinct count", () => {
    const rows = ["o1", "o2", "o3", "o4", "o5"].map((orgId) => sample({ orgId }));
    const out = aggregateLift(rows, { scope: "corpus" });
    expect(out.get(key())?.orgs).toBe(OUTCOME_MIN_ORGS);
  });

  it("corpus scope: 40 rows from ONE org are still one org — sample count never substitutes", () => {
    const rows = Array.from({ length: 40 }, () => sample({ orgId: "o1" }));
    expect(aggregateLift(rows, { scope: "corpus" }).size).toBe(0);
    // The same rows ARE publishable inside their own tenant.
    expect(aggregateLift(rows, { scope: "org" }).size).toBe(1);
  });
});

describe("aggregateLift — privacy", () => {
  it("a private sample never reaches a corpus partition", () => {
    const rows = [
      ...["o1", "o2", "o3", "o4", "o5"].map((orgId) => sample({ orgId })),
      sample({ orgId: "o6", isPrivateRepo: true, dimDelta: 99, overallDelta: 99 }),
    ];
    const out = aggregateLift(rows, { scope: "corpus" });
    const d = out.get(key());
    expect(d?.n).toBe(5); // the private row is absent from n …
    expect(d?.orgs).toBe(5); // … and from the org count …
    expect(d?.medianDim).toBe(11); // … and from the numbers
  });

  it("a private sample DOES count at org scope — it is the tenant's own repo", () => {
    const rows = [sample(), sample(), sample({ isPrivateRepo: true, dimDelta: 11 })];
    expect(aggregateLift(rows, { scope: "org" }).get(key())?.n).toBe(3);
  });
});

describe("aggregateLift — the instrument is a partition, never an average", () => {
  it("two rubric versions produce TWO partitions, never one median across the bump", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => sample({ rubricVersion: "r9", dimDelta: 2 })),
      ...Array.from({ length: 3 }, () => sample({ rubricVersion: "r10", dimDelta: 20 })),
    ];
    const out = aggregateLift(rows, { scope: "org" });
    expect(out.size).toBe(2);
    expect(out.get(key({ rubricVersion: "r9" }))?.medianDim).toBe(2);
    expect(out.get(key({ rubricVersion: "r10" }))?.medianDim).toBe(20);
    // Nothing anywhere in the map is the blended 11.
    expect([...out.values()].map((d) => d.medianDim)).not.toContain(11);
  });

  it("two engine providers partition the same way", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => sample({ engineProvider: "mock", dimDelta: 0 })),
      ...Array.from({ length: 3 }, () => sample({ engineProvider: "claude", dimDelta: 12 })),
    ];
    const out = aggregateLift(rows, { scope: "org" });
    expect(out.size).toBe(2);
    expect(out.get(key({ engineProvider: "mock" }))?.instrument.engineProvider).toBe("mock");
  });

  it("a null dimId partitions separately from a dimensioned one (whole-scan ≠ D2)", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => sample({ dimId: null, dimDelta: null })),
      ...Array.from({ length: 3 }, () => sample({ dimId: "D2" })),
    ];
    const out = aggregateLift(rows, { scope: "org" });
    expect(out.size).toBe(2);
    expect(out.get(key({ dimId: null }))?.medianDim).toBeNull();
  });
});

describe("aggregateLift — the numbers", () => {
  it("medianDim is null (not 0) when no sample carried one, and medianOverall still holds", () => {
    const rows = Array.from({ length: 3 }, () => sample({ dimDelta: null, overallDelta: 5 }));
    const d = aggregateLift(rows, { scope: "org" }).get(key());
    expect(d?.medianDim).toBeNull();
    expect(d?.p25).toBeNull();
    expect(d?.p75).toBeNull();
    expect(d?.medianOverall).toBe(5);
  });

  it("a dimension absent on one bookend is EXCLUDED from the median, never read as 0", () => {
    const rows = [sample({ dimDelta: 10 }), sample({ dimDelta: 12 }), sample({ dimDelta: null })];
    const d = aggregateLift(rows, { scope: "org" }).get(key());
    expect(d?.n).toBe(3); // it is still a measured outcome …
    expect(d?.medianDim).toBe(11); // … but the dim median is over the two that HAVE one
  });

  it("median and nearest-rank quartiles over an odd set", () => {
    const deltas = [1, 4, 6, 11, 15, 18, 30];
    const rows = deltas.map((dimDelta) => sample({ dimDelta, overallDelta: dimDelta }));
    const d = aggregateLift(rows, { scope: "org" }).get(key());
    expect(d?.medianDim).toBe(11);
    expect(d?.p25).toBe(4);
    expect(d?.p75).toBe(18);
    expect(d?.medianOverall).toBe(11);
  });

  it("a negative measured lift is reported as negative, never floored at zero", () => {
    const rows = [-6, -4, -1].map((dimDelta) => sample({ dimDelta, overallDelta: dimDelta }));
    const d = aggregateLift(rows, { scope: "org" }).get(key());
    expect(d?.medianDim).toBe(-4);
    expect(d?.medianOverall).toBe(-4);
  });

  it("an even-length set takes the midpoint of the two centres", () => {
    const rows = [2, 4, 6, 10].map((dimDelta) => sample({ dimDelta, overallDelta: dimDelta }));
    expect(aggregateLift(rows, { scope: "org" }).get(key())?.medianDim).toBe(5);
  });

  it("ignores a non-finite overallDelta rather than poisoning the median", () => {
    const rows = [sample(), sample(), sample(), sample({ overallDelta: Number.NaN })];
    expect(aggregateLift(rows, { scope: "org" }).get(key())?.n).toBe(3);
  });

  it("an empty input is an empty map", () => {
    expect(aggregateLift([], { scope: "corpus" }).size).toBe(0);
  });
});
