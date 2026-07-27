// Tests for the recall value model + budget packing. `now` is always injected, which is the whole point
// of keeping the core clock-free: every assertion below is a fixed number, not a moving target.
//
// The load-bearing guarantees pinned here:
//   - the half-life is per KIND (an episodic memory rots ~6x faster than a semantic one);
//   - a memory at exactly one half-life scores exactly half its confidence;
//   - accessCount helps sub-linearly and can never fabricate value out of a 0-confidence memory;
//   - packing NEVER truncates an item and never stops at the first item that doesn't fit;
//   - superseded / archived / expired rows can never reach an agent's context;
//   - the ordering is total and stable (ties break on id), so two identical calls agree.

import { describe, it, expect } from "vitest";
import {
  ageInDays,
  DEFAULT_CHAR_BUDGET,
  halfLifeDays,
  isRecallable,
  KIND_HALF_LIFE_DAYS,
  memoryValue,
  normalizeCharBudget,
  packByBudget,
  recallMemories,
  scoreMemories,
  type RecallCandidate,
} from "@/lib/memory/recall";

const NOW = Date.parse("2026-07-01T00:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const mem = (over: Partial<RecallCandidate> & { id: string }): RecallCandidate => ({
  content: "body",
  kind: "semantic",
  confidence: 1,
  updatedAt: daysAgo(0),
  accessCount: 0,
  ...over,
});

describe("half-lives", () => {
  it("are the documented per-kind constants", () => {
    expect(KIND_HALF_LIFE_DAYS).toEqual({ episodic: 30, semantic: 180, procedural: 365, summary: 120 });
  });
  it("fall back to the semantic default for an unknown/legacy kind", () => {
    expect(halfLifeDays("wat")).toBe(180);
  });
});

describe("ageInDays", () => {
  it("measures against the injected now", () => {
    expect(ageInDays(daysAgo(10), NOW)).toBeCloseTo(10, 6);
  });
  it("clamps a future timestamp to 0 rather than boosting the score", () => {
    expect(ageInDays(daysAgo(-30), NOW)).toBe(0);
  });
  it("treats an unparseable timestamp as brand new instead of poisoning the ranking with NaN", () => {
    expect(ageInDays("not a date", NOW)).toBe(0);
  });
});

describe("memoryValue", () => {
  it("is exactly confidence at age 0 with no recalls", () => {
    expect(memoryValue(mem({ id: "a", confidence: 0.6 }), NOW)).toBe(0.6);
  });

  it("halves at exactly one half-life, per kind", () => {
    expect(memoryValue(mem({ id: "a", kind: "episodic", updatedAt: daysAgo(30) }), NOW)).toBe(0.5);
    expect(memoryValue(mem({ id: "b", kind: "semantic", updatedAt: daysAgo(180) }), NOW)).toBe(0.5);
    expect(memoryValue(mem({ id: "c", kind: "procedural", updatedAt: daysAgo(365) }), NOW)).toBe(0.5);
    expect(memoryValue(mem({ id: "d", kind: "summary", updatedAt: daysAgo(120) }), NOW)).toBe(0.5);
  });

  it("ranks an old episodic memory below an equally old semantic one", () => {
    const ep = memoryValue(mem({ id: "a", kind: "episodic", updatedAt: daysAgo(90) }), NOW);
    const se = memoryValue(mem({ id: "b", kind: "semantic", updatedAt: daysAgo(90) }), NOW);
    expect(ep).toBeLessThan(se);
  });

  it("adds a sub-linear usage bonus (0.25·ln(1+n))", () => {
    const one = memoryValue(mem({ id: "a", accessCount: 1 }), NOW);
    const ten = memoryValue(mem({ id: "b", accessCount: 10 }), NOW);
    expect(one).toBeCloseTo(1 + 0.25 * Math.log(2), 4);
    // Sub-linear: 10x the recalls is far from 10x the bonus.
    expect(ten - 1).toBeLessThan(10 * (one - 1));
  });

  it("cannot fabricate value from a zero-confidence memory", () => {
    expect(memoryValue(mem({ id: "a", confidence: 0, accessCount: 500 }), NOW)).toBe(0);
  });

  it("clamps an out-of-range confidence rather than trusting it", () => {
    expect(memoryValue(mem({ id: "a", confidence: 5 }), NOW)).toBe(1);
    expect(memoryValue(mem({ id: "b", confidence: -3 }), NOW)).toBe(0);
  });

  it("is deterministic across calls (rounded, so float noise never reorders)", () => {
    const m = mem({ id: "a", confidence: 0.7, accessCount: 3, updatedAt: daysAgo(41) });
    expect(memoryValue(m, NOW)).toBe(memoryValue(m, NOW));
  });
});

describe("isRecallable", () => {
  it("excludes archived, superseded and expired rows", () => {
    expect(isRecallable(mem({ id: "a", archived: true }), NOW)).toBe(false);
    expect(isRecallable(mem({ id: "b", supersededBy: "x" }), NOW)).toBe(false);
    expect(isRecallable(mem({ id: "c", expiresAt: daysAgo(1) }), NOW)).toBe(false);
  });
  it("keeps a future TTL and a null one", () => {
    expect(isRecallable(mem({ id: "d", expiresAt: daysAgo(-1) }), NOW)).toBe(true);
    expect(isRecallable(mem({ id: "e", expiresAt: null }), NOW)).toBe(true);
  });
});

describe("scoreMemories", () => {
  it("sorts strongest first and breaks ties on id for a total, stable order", () => {
    const items = [mem({ id: "c" }), mem({ id: "a" }), mem({ id: "b", confidence: 0.2 })];
    expect(scoreMemories(items, NOW).map((s) => s.memory.id)).toEqual(["a", "c", "b"]);
  });
});

describe("packByBudget", () => {
  const scored = (id: string, score: number, len: number) => ({
    memory: mem({ id, content: "x".repeat(len) }),
    score,
    ageDays: 0,
  });

  it("packs whole items in descending score order", () => {
    const out = packByBudget([scored("a", 1, 40), scored("b", 0.9, 40)], 100);
    expect(out.selected.map((s) => s.memory.id)).toEqual(["a", "b"]);
    expect(out.usedChars).toBe(80);
  });

  it("never truncates an item mid-content", () => {
    const out = packByBudget([scored("big", 1, 500)], 100);
    expect(out.selected).toHaveLength(0);
    expect(out.omitted.map((s) => s.memory.id)).toEqual(["big"]);
    expect(out.usedChars).toBe(0);
  });

  it("skips an over-budget item and keeps filling with smaller ones behind it", () => {
    const out = packByBudget([scored("huge", 1, 900), scored("small", 0.5, 10)], 100);
    expect(out.selected.map((s) => s.memory.id)).toEqual(["small"]);
    expect(out.omitted.map((s) => s.memory.id)).toEqual(["huge"]);
  });

  it("fills to exactly the budget when it fits exactly", () => {
    const out = packByBudget([scored("a", 1, 60), scored("b", 0.5, 40)], 100);
    expect(out.usedChars).toBe(100);
    expect(out.omitted).toHaveLength(0);
  });
});

describe("normalizeCharBudget", () => {
  it("defaults a missing/garbage budget and clamps the extremes", () => {
    expect(normalizeCharBudget(undefined)).toBe(DEFAULT_CHAR_BUDGET);
    expect(normalizeCharBudget(null)).toBe(DEFAULT_CHAR_BUDGET);
    expect(normalizeCharBudget("")).toBe(DEFAULT_CHAR_BUDGET);
    expect(normalizeCharBudget("abc")).toBe(DEFAULT_CHAR_BUDGET);
    expect(normalizeCharBudget(0)).toBe(200);
    expect(normalizeCharBudget(10_000_000)).toBe(60_000);
    expect(normalizeCharBudget("1500")).toBe(1500);
  });
});

describe("recallMemories", () => {
  it("filters the ineligible, ranks the rest and reports what it considered", () => {
    const items = [
      mem({ id: "fresh", content: "a".repeat(50) }),
      mem({ id: "stale", kind: "episodic", updatedAt: daysAgo(400), content: "b".repeat(50) }),
      mem({ id: "gone", supersededBy: "fresh", content: "c".repeat(50) }),
    ];
    const out = recallMemories(items, { now: NOW, charBudget: 1000 });
    expect(out.consideredCount).toBe(2);
    expect(out.selected.map((s) => s.memory.id)).toEqual(["fresh", "stale"]);
  });

  it("honours the kind and namespace filters", () => {
    const items = [
      mem({ id: "a", kind: "procedural", namespace: "core" }),
      mem({ id: "b", kind: "semantic", namespace: "core" }),
      mem({ id: "c", kind: "procedural", namespace: "web" }),
    ];
    expect(
      recallMemories(items, { now: NOW, kinds: ["procedural"], namespace: "core" }).selected.map(
        (s) => s.memory.id,
      ),
    ).toEqual(["a"]);
  });

  it("returns a well-formed empty result for an empty store", () => {
    const out = recallMemories([], { now: NOW });
    expect(out).toMatchObject({ selected: [], omitted: [], usedChars: 0, consideredCount: 0 });
  });

  it("is deterministic: the same input at the same now yields the identical selection", () => {
    const items = [
      mem({ id: "a", confidence: 0.8, content: "x".repeat(300) }),
      mem({ id: "b", confidence: 0.8, content: "y".repeat(300) }),
      mem({ id: "c", confidence: 0.9, accessCount: 4, content: "z".repeat(300) }),
    ];
    const one = recallMemories(items, { now: NOW, charBudget: 700 });
    const two = recallMemories([...items].reverse(), { now: NOW, charBudget: 700 });
    expect(one.selected.map((s) => s.memory.id)).toEqual(two.selected.map((s) => s.memory.id));
  });
});
