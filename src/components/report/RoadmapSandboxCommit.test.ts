// Pins the sandbox → tracker join (D6): an applied roadmap item commits ONLY against a persisted,
// still-open recommendation matched by dimension+title (the key scans-persist.ts writes). A
// static-fallback roadmap (no persisted recs) yields nothing to commit — the bar disables. Pure
// transform, so it's tested without a DOM (ascent's Vitest default has no jsdom).

import { describe, it, expect } from "vitest";
import type { LlmRoadmapItem, PersistedRecommendation } from "@/lib/types";
import { committableRecs } from "./RoadmapSandboxCommit";

const roadmap = [
  { dimension: "D1", title: "Add agent guidance" },
  { dimension: "D1", title: "Add coverage gate" }, // same dim, different title
  { dimension: "D2", title: "Improve docs" },
] as unknown as LlmRoadmapItem[];

function rec(over: Partial<PersistedRecommendation>): PersistedRecommendation {
  return {
    id: "x",
    title: "",
    dimension: "D1",
    impact: "high",
    effort: "low",
    rationale: "",
    explore: [],
    status: "open",
    assigneeLogin: null,
    targetDate: null,
    ...over,
  } as PersistedRecommendation;
}

const recs = [
  rec({ id: "r1", dimension: "D1", title: "Add agent guidance", status: "open" }),
  rec({ id: "r2", dimension: "D1", title: "Add coverage gate", status: "in_progress" }), // not open
  rec({ id: "r3", dimension: "D2", title: "Improve docs", status: "open" }),
];

describe("committableRecs (sandbox → tracker join)", () => {
  it("matches an applied item to its persisted open rec by dimension+title", () => {
    const out = committableRecs(roadmap, recs, new Set([0]));
    expect(out.map((r) => r.id)).toEqual(["r1"]);
  });

  it("skips a matched rec that is not open (already in_progress/done)", () => {
    const out = committableRecs(roadmap, recs, new Set([1]));
    expect(out).toHaveLength(0);
  });

  it("only commits the applied items — a sibling on the same dimension is untouched", () => {
    const out = committableRecs(roadmap, recs, new Set([0, 2]));
    expect(out.map((r) => r.id)).toEqual(["r1", "r3"]);
  });

  it("returns nothing when tracking is off (recs null) — the static-fallback roadmap", () => {
    expect(committableRecs(roadmap, null, new Set([0, 1, 2]))).toHaveLength(0);
  });

  it("dedupes so a rec is never committed twice", () => {
    // Two applied indices resolving to the same rec id (defensive) collapse to one.
    const dupeRoadmap = [
      { dimension: "D1", title: "Add agent guidance" },
      { dimension: "D1", title: "Add agent guidance" },
    ] as unknown as LlmRoadmapItem[];
    const out = committableRecs(dupeRoadmap, [rec({ id: "r1", title: "Add agent guidance" })], new Set([0, 1]));
    expect(out.map((r) => r.id)).toEqual(["r1"]);
  });
});
