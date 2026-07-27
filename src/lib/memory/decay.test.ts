// Tests for the forget (archive-by-decay) policy. `now` and the archiver are both injected, so the
// policy is pinned exactly without a database.
//
// The load-bearing guarantees pinned here — each is a way this could quietly destroy an org's knowledge:
//   - all FOUR conditions are required; each boundary is tested from both sides;
//   - procedural memory is never archived automatically, whatever it scores;
//   - a confident memory is never archived by age alone;
//   - a frequently recalled memory survives (usage is a veto on forgetting);
//   - dryRun performs no write at all;
//   - one pass is capped (DECAY_MAX_PER_PASS) so a bad policy edit can't empty a store in one call.

import { describe, it, expect, vi } from "vitest";
import {
  archiveDecayed,
  decayVerdict,
  DECAY_EXEMPT_KINDS,
  DECAY_MAX_CONFIDENCE,
  DECAY_MAX_PER_PASS,
  DECAY_MIN_AGE_DAYS,
  DECAY_SCORE_FLOOR,
  selectDecayed,
} from "@/lib/memory/decay";
import type { RecallCandidate } from "@/lib/memory/recall";

const NOW = Date.parse("2026-07-01T00:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

/** The archetype: old, low-confidence, unused semantic memory — the one thing forget exists to retire. */
const rotten = (over: Partial<RecallCandidate> = {}): RecallCandidate => ({
  id: "rot",
  content: "some half-remembered hunch about the billing job",
  kind: "semantic",
  confidence: 0.3,
  updatedAt: daysAgo(900),
  accessCount: 0,
  ...over,
});

describe("policy constants", () => {
  it("are the documented values", () => {
    expect(DECAY_SCORE_FLOOR).toBe(0.15);
    expect(DECAY_MIN_AGE_DAYS).toBe(60);
    expect(DECAY_MAX_CONFIDENCE).toBe(0.3);
    expect(DECAY_EXEMPT_KINDS).toEqual(["procedural"]);
  });
});

describe("decayVerdict", () => {
  it("archives the archetype", () => {
    const v = decayVerdict(rotten(), NOW);
    expect(v.archive).toBe(true);
    expect(v.score).toBeLessThan(DECAY_SCORE_FLOOR);
  });

  it("never archives procedural memory, however rotten", () => {
    const v = decayVerdict(rotten({ kind: "procedural", confidence: 0.1, updatedAt: daysAgo(5000) }), NOW);
    expect(v.archive).toBe(false);
    expect(v.sparedBy).toBe("kind");
  });

  it("spares anything above the low-confidence band (boundary: 0.3 in, 0.31 out)", () => {
    expect(decayVerdict(rotten({ confidence: 0.3 }), NOW).archive).toBe(true);
    const spared = decayVerdict(rotten({ confidence: 0.31 }), NOW);
    expect(spared.archive).toBe(false);
    expect(spared.sparedBy).toBe("confidence");
  });

  it("spares anything inside the 60-day grace period, whatever it scores", () => {
    const young = decayVerdict(rotten({ confidence: 0.05, updatedAt: daysAgo(59) }), NOW);
    expect(young.archive).toBe(false);
    expect(young.sparedBy).toBe("age");
    // Exactly 60 days is still spared (the condition is age > 60).
    expect(decayVerdict(rotten({ confidence: 0.05, updatedAt: daysAgo(60) }), NOW).sparedBy).toBe("age");
    expect(decayVerdict(rotten({ confidence: 0.05, updatedAt: daysAgo(61) }), NOW).archive).toBe(true);
  });

  it("spares a memory still above the score floor (boundary in both directions)", () => {
    // semantic, half-life 180d: 0.3 × 0.5^(180/180) = 0.15 → exactly the floor, spared.
    const atFloor = decayVerdict(rotten({ updatedAt: daysAgo(180) }), NOW);
    expect(atFloor.score).toBe(0.15);
    expect(atFloor.archive).toBe(false);
    expect(atFloor.sparedBy).toBe("score");
    expect(decayVerdict(rotten({ updatedAt: daysAgo(181) }), NOW).archive).toBe(true);
  });

  it("spares an old, low-confidence memory that is still being recalled — usage vetoes forgetting", () => {
    const hot = decayVerdict(rotten({ updatedAt: daysAgo(200), accessCount: 200 }), NOW);
    expect(hot.score).toBeGreaterThanOrEqual(DECAY_SCORE_FLOOR);
    expect(hot.archive).toBe(false);
  });
});

describe("selectDecayed", () => {
  it("ignores rows that are already archived, superseded or expired", () => {
    const items = [
      rotten({ id: "a", archived: true }),
      rotten({ id: "b", supersededBy: "z" }),
      rotten({ id: "c", expiresAt: daysAgo(1) }),
      rotten({ id: "d" }),
    ];
    expect(selectDecayed(items, NOW).map((v) => v.id)).toEqual(["d"]);
  });

  it("takes the weakest first and caps one pass at DECAY_MAX_PER_PASS", () => {
    const items = Array.from({ length: DECAY_MAX_PER_PASS + 10 }, (_, i) =>
      rotten({ id: `m${String(i).padStart(3, "0")}` }),
    );
    const out = selectDecayed(items, NOW);
    expect(out).toHaveLength(DECAY_MAX_PER_PASS);
  });

  it("orders by ascending score so the weakest go first when the cap bites", () => {
    const out = selectDecayed(
      [rotten({ id: "weaker", confidence: 0.05 }), rotten({ id: "stronger", confidence: 0.3, updatedAt: daysAgo(200) })],
      NOW,
    );
    expect(out.map((v) => v.id)).toEqual(["weaker", "stronger"]);
  });
});

describe("archiveDecayed", () => {
  it("archives the selected ids and reports the archiver's count", async () => {
    const archive = vi.fn(async (ids: string[]) => ids.length);
    const report = await archiveDecayed([rotten({ id: "a" }), rotten({ id: "b", confidence: 1 })], NOW, archive);
    expect(archive).toHaveBeenCalledWith(["a"]);
    expect(report).toMatchObject({ archivedIds: ["a"], archivedCount: 1, evaluated: 2, dryRun: false });
  });

  it("writes NOTHING in dryRun, while still reporting what it would archive", async () => {
    const archive = vi.fn();
    const report = await archiveDecayed([rotten()], NOW, archive, { dryRun: true });
    expect(archive).not.toHaveBeenCalled();
    expect(report.archivedIds).toEqual(["rot"]);
    expect(report.archivedCount).toBe(0);
    expect(report.dryRun).toBe(true);
  });

  it("never calls the archiver when nothing decayed", async () => {
    const archive = vi.fn();
    const report = await archiveDecayed([rotten({ confidence: 1 })], NOW, archive);
    expect(archive).not.toHaveBeenCalled();
    expect(report.archivedIds).toEqual([]);
  });
});
