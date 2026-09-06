// A mock score must not be averaged into a figure presented as a measurement.
//
// `engine: "mock"` is the deterministic FLOOR the scanner emits when it never called a model —
// a placeholder, not a grade. `avgRealMove` has always excluded engine-transition deltas so a
// mock→live re-scan cannot fake improvement; the fleet/group AVERAGE had no such defence and was
// computed over every scored repo including the placeholders, with a separate "N mock" chip as the
// only disclosure. These tests pin the exclusion, and — just as importantly — pin that excluding
// mocks can never manufacture a `0`: an all-mock or empty set has NO average (null), which the
// renderers land on their "—" no-score path.

import { describe, expect, it } from "vitest";

import {
  avgRealMove,
  avgRealScore,
  realScoredRepos,
  summarize,
  type RepoTrajectory,
} from "@/features/standing/overview/repoTrajectory";
import { agg, buildGroups } from "@/features/standing/overview/repoCategoryRollupLogic";
import { buildScoreBadges, type StandingSource } from "@/features/standing/overview/overviewStanding";

function repo(name: string, overall: number, engine: string, opts: Partial<RepoTrajectory> = {}): RepoTrajectory {
  return {
    fullName: `acme/${name}`,
    name,
    owner: "acme",
    techStack: null,
    level: "L3",
    overall,
    adoption: overall,
    rigor: overall,
    posture: "manual",
    scannedAt: "2026-01-01T00:00:00.000Z",
    engine,
    points: [],
    scans: 0,
    deltaWindow: null,
    deltaLast: null,
    deltaCrossesEngine: false,
    tone: "flat",
    lo: overall,
    hi: overall,
    ...opts,
  };
}

// A live-scored fleet at 80/60, plus a mock placeholder floored at 20. The contaminated average is
// 53; the honest one is 70. The gap is the whole point of the fix.
const MIXED = [repo("a", 80, "anthropic"), repo("b", 60, "anthropic"), repo("c", 20, "mock")];
const ALL_MOCK = [repo("a", 20, "mock"), repo("b", 24, "mock")];

describe("avgRealScore / realScoredRepos — the average's honest denominator", () => {
  it("averages a mixed fleet over the live-scored repos only", () => {
    expect(avgRealScore(MIXED)).toBe(70); // NOT 53 — the mock floor is not a measurement
    expect(realScoredRepos(MIXED).map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("returns null — never 0 — for an all-mock fleet", () => {
    expect(avgRealScore(ALL_MOCK)).toBeNull();
    expect(realScoredRepos(ALL_MOCK)).toEqual([]);
  });

  it("returns null for a zero-scored (empty) set instead of NaN or 0", () => {
    expect(avgRealScore([])).toBeNull();
  });

  it("leaves an all-live fleet's average exactly as it was", () => {
    const live = [repo("a", 80, "anthropic"), repo("b", 60, "openai")];
    expect(avgRealScore(live)).toBe(70);
  });

  it("treats every non-'mock' engine id as a real grade", () => {
    expect(avgRealScore([repo("a", 40, "claude-cli"), repo("b", 60, "anthropic")])).toBe(50);
  });
});

describe("summarize — the fleet masthead", () => {
  it("reports the mock-free average alongside the count it excluded", () => {
    const s = summarize(MIXED);
    expect(s.avgOverall).toBe(70);
    expect(s.realScored).toBe(2);
    expect(s.mock).toBe(1);
    expect(s.repos).toBe(3); // the repo COUNT still describes the whole set
  });

  it("has no average for an all-mock fleet, and says so via realScored/mock", () => {
    const s = summarize(ALL_MOCK);
    expect(s.avgOverall).toBeNull();
    expect(s.realScored).toBe(0);
    expect(s.mock).toBe(2);
    expect(s.repos).toBe(2);
  });

  it("has no average for a zero-scored fleet", () => {
    const s = summarize([]);
    expect(s.avgOverall).toBeNull();
    expect(s.realScored).toBe(0);
    expect(s.mock).toBe(0);
    expect(s.repos).toBe(0);
  });

  it("still excludes engine-transition deltas from avgMove (unchanged precedent)", () => {
    // Two real movers (+10, +20) and one mock→live transition that would have read as +50.
    const rows = [
      repo("a", 80, "anthropic", { deltaWindow: 10 }),
      repo("b", 60, "anthropic", { deltaWindow: 20 }),
      repo("c", 70, "anthropic", { deltaWindow: 50, deltaCrossesEngine: true }),
    ];
    expect(summarize(rows).avgMove).toBe(15);
    expect(avgRealMove(rows)).toBe(15);
  });
});

describe("agg — per-group aggregates", () => {
  it("excludes mocks from a group's average and reports the denominator", () => {
    expect(agg(MIXED)).toEqual({ avg: 70, realScored: 2, net: null });
  });

  it("gives an all-mock group no average rather than a 0", () => {
    expect(agg(ALL_MOCK)).toEqual({ avg: null, realScored: 0, net: null });
  });

  it("gives an empty group no average (the guard that used to divide by zero)", () => {
    expect(agg([])).toEqual({ avg: null, realScored: 0, net: null });
  });

  it("sorts an unmeasured cohort LAST, not as the worst-scoring one", () => {
    // Mirrors RepoCategoryRollup's group ordering: (avg ?? -1) descending.
    const rows = [
      repo("live-hi", 80, "anthropic", { posture: "ai-native" }),
      repo("live-lo", 30, "anthropic", { posture: "manual" }),
      repo("placeholder", 90, "mock", { posture: "early" }),
    ];
    const order = buildGroups("type", rows)
      .sort((a, b) => (agg(b.rows).avg ?? -1) - (agg(a.rows).avg ?? -1))
      .map((g) => g.key);
    expect(order).toEqual(["ai-native", "manual", "early"]);
    // …and the all-mock cohort's inflated 90 never becomes a score at all.
    expect(agg(rows.filter((r) => r.posture === "early")).avg).toBeNull();
  });
});

// ── The headline badge and the cohort card are ONE number ──────────────────────────────────────────
//
// Both sit in the same scroll on the Overview. The cohort card has excluded mocks since the fix these
// tests pin; the headline badge averaged them in, so with any mock repo present the two disagreed —
// and the headline was the one without a stated basis. The exclusion now lives in the PRODUCER
// (`getOrgRollup`, pinned in src/lib/db/org-rollup.test.ts: the MIXED fleet below yields
// avgOverall 70 / realScoredCount 2 / mockCount 1), so the badge inherits it. This pins the join:
// the same fleet, read through both paths, states the same average and the same denominator.
describe("badge vs cohort card — one fleet average, one denominator", () => {
  /** The StandingSource `getOrgRollup` emits for MIXED (see org-rollup.test.ts for that assertion). */
  const FROM_ROLLUP: StandingSource = {
    avgOverall: 70,
    avgAdoption: 70,
    avgRigor: 70,
    scannedCount: MIXED.length,
    repoCount: MIXED.length,
    deltas: null,
    realScoredCount: 2,
    mockCount: 1,
  };

  it("states the same average as the cohort card for a fleet with one mock repo", () => {
    const card = summarize(MIXED);
    const [badge] = buildScoreBadges(FROM_ROLLUP);
    expect(badge!.value).toBe(card.avgOverall); // 70 on both — NOT 53 on one and 70 on the other
  });

  it("states the same denominator, and discloses the same exclusion", () => {
    const card = summarize(MIXED);
    const [badge] = buildScoreBadges(FROM_ROLLUP);
    expect(FROM_ROLLUP.realScoredCount).toBe(card.realScored);
    expect(FROM_ROLLUP.mockCount).toBe(card.mock);
    expect(badge!.note).toBe("1 mock (excluded from avg)");
  });
});
