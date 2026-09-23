// The pure half of "each lifecycle pass loads its own population" (challenge-2026-09-23b, org-memory#A).
//
// FAILS BEFORE: the module did not exist. Every lifecycle pass loaded the same `updatedAt desc, take
// 400` working set, so recency chose the population before recall's value model or forget's
// conjunction ever saw a row.
//
// What is pinned:
//   - planRecallLanes splits the cap across kinds and hands a thin kind's unused quota to the others,
//     so one noisy kind (scan-fed episodic rows) cannot starve procedural or semantic memory, and the
//     part of the store the cap leaves out is COUNTED rather than implied away;
//   - decayPopulationWhere is DERIVED from decay.ts's own constants: editing DECAY_MIN_AGE_DAYS moves
//     the predicate, because it is read, never restated.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DECAY_POPULATION_ORDER,
  RECALL_POPULATION_MAX,
  decayPopulationWhere,
  planRecallLanes,
} from "@/lib/memory/working-set";
import { DECAY_EXEMPT_KINDS, DECAY_MAX_CONFIDENCE, DECAY_MIN_AGE_DAYS } from "@/lib/memory/decay";

const DAY = 86_400_000;
const sum = (q: Record<string, number>) => Object.values(q).reduce((a, b) => a + b, 0);

describe("planRecallLanes: the cap split across kinds", () => {
  it("hands a thin kind's unused quota to the others and counts what the cap left out", () => {
    const plan = planRecallLanes({ episodic: 500, semantic: 10, procedural: 3, summary: 0 }, 400);
    expect(plan.quotas).toEqual({ procedural: 3, semantic: 10, summary: 0, episodic: 387 });
    expect(sum(plan.quotas)).toBe(400);
    expect(plan.notConsidered).toBe(113);
  });

  it("sums to min(limit, total) whatever the mix", () => {
    const cases: [Record<string, number>, number][] = [
      [{ episodic: 300, semantic: 300, procedural: 300 }, 400],
      [{ episodic: 1, semantic: 1 }, 400],
      [{ episodic: 7, semantic: 5, procedural: 2, summary: 1 }, 3],
      [{ a: 133, b: 134, c: 135 }, 400],
    ];
    for (const [counts, limit] of cases) {
      const plan = planRecallLanes(counts, limit);
      const total = sum(counts);
      expect(sum(plan.quotas)).toBe(Math.min(limit, total));
      expect(plan.notConsidered).toBe(total - Math.min(limit, total));
      for (const [k, q] of Object.entries(plan.quotas)) expect(q).toBeLessThanOrEqual(counts[k]!);
    }
  });

  it("splits evenly between equally crowded kinds, so no kind starves another", () => {
    const plan = planRecallLanes({ episodic: 300, semantic: 300, procedural: 300 }, 399);
    expect(plan.quotas).toEqual({ episodic: 133, semantic: 133, procedural: 133 });
  });

  it("takes everything, and leaves nothing out, when the store fits the cap", () => {
    const plan = planRecallLanes({ episodic: 20, procedural: 4 }, RECALL_POPULATION_MAX);
    expect(plan.quotas).toEqual({ episodic: 20, procedural: 4 });
    expect(plan.notConsidered).toBe(0);
  });

  it("treats a negative or fractional count or limit as the floor it can honestly mean", () => {
    const plan = planRecallLanes({ episodic: -3, semantic: 2.7 }, 1.9);
    expect(plan.quotas).toEqual({ episodic: 0, semantic: 1 });
    expect(plan.notConsidered).toBe(1);
  });
});

describe("decayPopulationWhere: forget's population, derived from decay.ts", () => {
  const now = Date.parse("2026-09-01T00:00:00.000Z");

  afterEach(() => {
    vi.doUnmock("@/lib/memory/decay");
    vi.resetModules();
  });

  it("is the three row-level conditions of the forget conjunction, oldest first", () => {
    expect(decayPopulationWhere(now)).toEqual({
      kind: { notIn: [...DECAY_EXEMPT_KINDS] },
      confidence: { lte: DECAY_MAX_CONFIDENCE },
      updatedAt: { lt: new Date(now - DECAY_MIN_AGE_DAYS * DAY) },
    });
    expect(DECAY_POPULATION_ORDER).toEqual({ updatedAt: "asc" });
  });

  it("moves when DECAY_MIN_AGE_DAYS moves: the age floor is read, never restated", async () => {
    vi.resetModules();
    vi.doMock("@/lib/memory/decay", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/memory/decay")>()),
      DECAY_MIN_AGE_DAYS: 7,
      DECAY_MAX_CONFIDENCE: 0.5,
      DECAY_EXEMPT_KINDS: ["procedural", "summary"],
    }));
    const edited = await import("@/lib/memory/working-set");
    expect(edited.decayPopulationWhere(now)).toEqual({
      kind: { notIn: ["procedural", "summary"] },
      confidence: { lte: 0.5 },
      updatedAt: { lt: new Date(now - 7 * DAY) },
    });
  });
});
