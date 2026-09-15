// The measured roadmap ordering (moonshot #9). Two properties carry the whole design, and both are
// invisible until they are already wrong:
//
//   1. WITH AN EMPTY LEDGER, `measured` returns byte-identical order to `priority`. Every org starts
//      here and most stay here for months, so the "new" sort must be provably the old sort until
//      there is evidence — not "roughly the same because the scores happen to tie".
//   2. A measured item CANNOT bury an unmeasured higher-impact item. The naive version of this
//      feature ("sort by median lift, unmeasured last") inverts the roadmap the moment a ledger holds
//      three rows about one trivial gap and nothing about anything else — it presents ignorance about
//      an item as evidence against it, which is the G4 failure in ordering form.

import { describe, expect, it } from "vitest";
import type { LiftDistribution } from "@/lib/outcomes/aggregate";
import type { Effort, Impact } from "@/lib/types";
import {
  MEASURED_BOOST_CAP,
  measuredPriorityScore,
  priorityScore,
  roadmapLiftKey,
  sortRoadmap,
} from "./roadmapPriority";

type Item = { title: string; dimension: "D1" | "D2" | "D3"; impact: Impact; effort: Effort };

const item = (title: string, impact: Impact, effort: Effort, dimension: Item["dimension"] = "D2"): Item => ({
  title,
  dimension,
  impact,
  effort,
});

const dist = (medianDim: number, over: Partial<LiftDistribution> = {}): LiftDistribution => ({
  identityKey: "",
  dimId: "D2",
  n: 12,
  orgs: 1,
  medianDim,
  p25: medianDim,
  p75: medianDim,
  medianOverall: 2,
  instrument: { rubricVersion: "r10", engineProvider: "claude" },
  ...over,
});

const liftsFor = (pairs: [Item, LiftDistribution][]): Map<string, LiftDistribution> =>
  new Map(pairs.map(([it, d]) => [roadmapLiftKey(it), { ...d, identityKey: roadmapLiftKey(it) }]));

// A deliberately unsorted list spanning every impact/effort combination that matters.
const ROADMAP: Item[] = [
  item("adopt review checklist", "medium", "high"),
  item("write an ADR log", "high", "low", "D1"),
  item("pin the model version", "low", "low", "D3"),
  item("add PR templates", "high", "medium"),
  item("split the monolith", "high", "high", "D3"),
  item("tag owners in CODEOWNERS", "medium", "low", "D1"),
];

describe("sortRoadmap — an empty ledger changes NOTHING", () => {
  it("'measured' with no lift map returns byte-identical order to 'priority'", () => {
    const priority = sortRoadmap(ROADMAP, null, "priority").map((i) => i.title);
    expect(sortRoadmap(ROADMAP, null, "measured").map((i) => i.title)).toEqual(priority);
    expect(sortRoadmap(ROADMAP, new Map(), "measured").map((i) => i.title)).toEqual(priority);
    expect(sortRoadmap(ROADMAP, undefined, "measured").map((i) => i.title)).toEqual(priority);
  });

  it("a lift map holding OTHER gaps' evidence leaves this roadmap's order alone", () => {
    const stranger = item("a gap on another repo", "high", "low");
    const lifts = liftsFor([[stranger, dist(30)]]);
    expect(sortRoadmap(ROADMAP, lifts, "measured").map((i) => i.title)).toEqual(
      sortRoadmap(ROADMAP, null, "priority").map((i) => i.title),
    );
  });

  it("'priority' mode ignores the lift map entirely, however strong the evidence", () => {
    const lifts = liftsFor([[ROADMAP[2]!, dist(40)]]); // the lowest-priority item, hugely measured
    expect(sortRoadmap(ROADMAP, lifts, "priority").map((i) => i.title)).toEqual(
      sortRoadmap(ROADMAP, null, "priority").map((i) => i.title),
    );
  });

  it("defaults to 'priority' when no mode is given", () => {
    expect(sortRoadmap(ROADMAP, liftsFor([[ROADMAP[2]!, dist(40)]])).map((i) => i.title)).toEqual(
      sortRoadmap(ROADMAP, null, "priority").map((i) => i.title),
    );
  });
});

describe("sortRoadmap — measurement re-orders inside the impact band, never across it", () => {
  it("a measured low-impact item never displaces an unmeasured high-impact one to the bottom", () => {
    const low = ROADMAP[2]!; // low impact, low effort — bottom of the priority order
    const lifts = liftsFor([[low, dist(1000)]]); // absurd evidence, deliberately
    const ordered = sortRoadmap(ROADMAP, lifts, "measured").map((i) => i.title);
    const highs = ROADMAP.filter((i) => i.impact === "high").map((i) => i.title);
    for (const h of highs) expect(ordered.indexOf(h)).toBeLessThan(ordered.indexOf(low.title));
  });

  it("the boost is capped below one impact rank, so the cap is the guarantee", () => {
    const low = ROADMAP[2]!;
    expect(measuredPriorityScore(low, liftsFor([[low, dist(1000)]])) - priorityScore(low)).toBe(MEASURED_BOOST_CAP);
    expect(MEASURED_BOOST_CAP).toBeLessThan(10); // one IMPACT_RANK step
  });

  it("measured evidence DOES break an effort tie inside the same impact band", () => {
    const a = item("measured medium", "medium", "medium", "D1");
    const b = item("unmeasured medium", "medium", "medium", "D2");
    const lifts = liftsFor([[a, dist(12)]]);
    expect(sortRoadmap([b, a], lifts, "measured").map((i) => i.title)).toEqual([a.title, b.title]);
    // …and with no evidence the pair keeps its input order (stable sort, equal scores).
    expect(sortRoadmap([b, a], null, "measured").map((i) => i.title)).toEqual([b.title, a.title]);
  });

  it("a NEGATIVE measured lift demotes within the band rather than being read as no evidence", () => {
    const a = item("measured badly", "medium", "medium", "D1");
    const b = item("unmeasured", "medium", "medium", "D2");
    const lifts = liftsFor([[a, dist(-10)]]);
    expect(sortRoadmap([a, b], lifts, "measured").map((i) => i.title)).toEqual([b.title, a.title]);
  });
});

describe("measuredPriorityScore", () => {
  it("is exactly priorityScore when the item has no distribution", () => {
    for (const it of ROADMAP) expect(measuredPriorityScore(it, new Map())).toBe(priorityScore(it));
  });

  it("falls back to the overall median when the partition has no dimension median", () => {
    const it = ROADMAP[0]!;
    const lifts = liftsFor([[it, dist(0, { medianDim: null, medianOverall: 6 })]]);
    expect(measuredPriorityScore(it, lifts)).toBe(priorityScore(it) + 3);
  });

  it("treats an under-floor distribution as no evidence at all", () => {
    const it = ROADMAP[0]!;
    const lifts = liftsFor([[it, dist(20, { n: 2 })]]);
    expect(measuredPriorityScore(it, lifts)).toBe(priorityScore(it));
  });

  it("keys on the SAME identity a stored decision uses — a re-cased title still matches", () => {
    const it = ROADMAP[0]!;
    const rephrased = { ...it, title: "  Adopt Review Checklist.  " };
    expect(roadmapLiftKey(rephrased)).toBe(roadmapLiftKey(it));
    const lifts = liftsFor([[it, dist(12)]]);
    expect(measuredPriorityScore(rephrased, lifts)).toBe(measuredPriorityScore(it, lifts));
  });
});
