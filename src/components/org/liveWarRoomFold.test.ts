import { describe, it, expect } from "vitest";
import { foldRepoEvent, computeStats, computeLeaderboard } from "./liveWarRoomFold";
import type { LiveRepo, Mover } from "./liveWarRoomShared";

// The live war-room wall folds a stream of `repo` SSE events into three derived views: the repos
// map (headline averages + posture distribution), the leaderboard ordering, and a celebration that
// must fire EXACTLY ONCE when a repo crosses into AI-Native. These tests pin that fold without a
// React renderer (ascent's Vitest has no jsdom). `foldRepoEvent` is pure: prev-state + event + id →
// a description of the change (next repos / ticker row / skip bump / celebration), which the
// component applies. The monotonic `id` is the caller's; here we pass it explicitly.

const seedRepo = (over: Partial<LiveRepo> & { fullName: string }): LiveRepo => ({
  name: over.fullName.split("/").pop()!,
  overall: null,
  adoption: null,
  rigor: null,
  level: null,
  posture: null,
  updatedAt: 0,
  ...over,
});

const repoMap = (...repos: LiveRepo[]): Record<string, LiveRepo> =>
  Object.fromEntries(repos.map((r) => [r.fullName, r]));

describe("foldRepoEvent — scored events", () => {
  it("folds a scored repo into the map, stamps updatedAt with the id, and emits a ticker row", () => {
    const prev = repoMap(seedRepo({ fullName: "acme/api" }));
    const r = foldRepoEvent(prev, [], { repo: "acme/api", overall: 62, adoption: 55, rigor: 70, level: "L3", posture: "manual" }, 7);

    expect(r.repos).not.toBeNull();
    expect(r.repos!["acme/api"]).toEqual({
      fullName: "acme/api",
      name: "api",
      overall: 62,
      adoption: 55,
      rigor: 70,
      level: "L3",
      posture: "manual",
      updatedAt: 7,
    });
    expect(r.skippedDelta).toBe(0);
    expect(r.celebration).toBeNull();
    expect(r.ticker).toEqual([
      { id: 7, fullName: "acme/api", name: "api", overall: 62, level: "L3", posture: "manual", delta: null, failed: false },
    ]);
  });

  it("computes delta against the repo's previous overall and prepends the ticker (newest first)", () => {
    const prev = repoMap(seedRepo({ fullName: "acme/api", overall: 50, posture: "manual" }));
    const existing: Mover[] = [{ id: 1, fullName: "x/y", name: "y", overall: 10, level: null, posture: null, delta: null, failed: false }];
    const r = foldRepoEvent(prev, existing, { repo: "acme/api", overall: 62, posture: "manual" }, 8);

    expect(r.ticker![0]).toMatchObject({ id: 8, fullName: "acme/api", delta: 12, failed: false });
    expect(r.ticker![1]).toBe(existing[0]); // older rows kept, identity preserved
  });

  it("seeds a repo not yet in the map (delta null on first-ever scan) and derives the short name", () => {
    const r = foldRepoEvent({}, [], { repo: "org/the-service", overall: 40, posture: "early" }, 1);
    expect(r.repos!["org/the-service"].name).toBe("the-service");
    expect(r.ticker![0].delta).toBeNull();
  });
});

describe("foldRepoEvent — celebration on crossing into AI-Native", () => {
  it("fires a celebration when a repo crosses INTO ai-native from another posture", () => {
    const prev = repoMap(seedRepo({ fullName: "acme/api", overall: 80, posture: "manual" }));
    const r = foldRepoEvent(prev, [], { repo: "acme/api", overall: 90, posture: "ai-native", level: "L5" }, 9);
    expect(r.celebration).toEqual({ id: 9, name: "api", level: "L5", overall: 90 });
  });

  it("fires once on the crossing, NOT again on a subsequent ai-native event (no repeat)", () => {
    // First event crosses into ai-native → celebration.
    const prev = repoMap(seedRepo({ fullName: "acme/api", overall: 80, posture: "manual" }));
    const first = foldRepoEvent(prev, [], { repo: "acme/api", overall: 90, posture: "ai-native" }, 1);
    expect(first.celebration).not.toBeNull();

    // Apply the result, then a SECOND ai-native event for the same repo must NOT re-celebrate.
    const second = foldRepoEvent(first.repos!, [], { repo: "acme/api", overall: 91, posture: "ai-native" }, 2);
    expect(second.celebration).toBeNull();
  });

  it("does not celebrate a repo that was ALREADY ai-native when seeded", () => {
    const prev = repoMap(seedRepo({ fullName: "acme/api", overall: 88, posture: "ai-native" }));
    const r = foldRepoEvent(prev, [], { repo: "acme/api", overall: 92, posture: "ai-native" }, 5);
    expect(r.celebration).toBeNull();
  });

  it("does not celebrate a scored event that is not ai-native", () => {
    const r = foldRepoEvent({}, [], { repo: "acme/api", overall: 50, posture: "manual" }, 3);
    expect(r.celebration).toBeNull();
  });
});

describe("foldRepoEvent — error / skip / invalid never overwrite real standing", () => {
  it("an error event is ticker-only: no repos change, no skip bump, a failed ticker row", () => {
    const prev = repoMap(seedRepo({ fullName: "acme/api", overall: 60, posture: "manual" }));
    const r = foldRepoEvent(prev, [], { repo: "acme/api", error: "scan failed" }, 4);
    expect(r.repos).toBeNull(); // seeded standing untouched
    expect(r.skippedDelta).toBe(0);
    expect(r.celebration).toBeNull();
    expect(r.ticker![0]).toEqual({ id: 4, fullName: "acme/api", name: "api", overall: null, level: null, posture: null, delta: null, failed: true });
  });

  it("a credit-skipped event bumps the skip counter and shows a muted (skipped) ticker row only", () => {
    const r = foldRepoEvent({}, [], { repo: "acme/api", skipped: "insufficient_credits" }, 6);
    expect(r.repos).toBeNull();
    expect(r.skippedDelta).toBe(1);
    expect(r.ticker![0]).toMatchObject({ id: 6, fullName: "acme/api", failed: false, skipped: true, overall: null });
  });

  it("an invalid/malformed event (non-finite overall) is dropped entirely — a true no-op", () => {
    const prev = repoMap(seedRepo({ fullName: "acme/api", overall: 60, posture: "manual" }));
    const r = foldRepoEvent(prev, [], { repo: "acme/api", overall: "not-a-number" }, 9);
    expect(r).toEqual({ repos: null, ticker: null, skippedDelta: 0, celebration: null });
  });

  it("an event with no repo name is a no-op (never folds an unnamed standing)", () => {
    const r = foldRepoEvent({}, [], { overall: 70, posture: "ai-native" }, 1);
    expect(r).toEqual({ repos: null, ticker: null, skippedDelta: 0, celebration: null });
  });

  it("a duplicate/out-of-order scored event re-states (does not double-count) — the map keys on fullName", () => {
    const prev = repoMap(seedRepo({ fullName: "acme/api", overall: 50, posture: "manual" }));
    const a = foldRepoEvent(prev, [], { repo: "acme/api", overall: 60, posture: "manual" }, 1);
    const b = foldRepoEvent(a.repos!, [], { repo: "acme/api", overall: 60, posture: "manual" }, 2);
    // The repo appears exactly once; the second event overwrites in place rather than adding a row.
    expect(Object.keys(b.repos!)).toEqual(["acme/api"]);
    expect(computeStats(b.repos!).scored).toBe(1);
  });

  it("preserves identity of OTHER repos in the map (only the touched key is replaced)", () => {
    const other = seedRepo({ fullName: "acme/web", overall: 30, posture: "early" });
    const prev = repoMap(seedRepo({ fullName: "acme/api", overall: 50, posture: "manual" }), other);
    const r = foldRepoEvent(prev, [], { repo: "acme/api", overall: 62, posture: "manual" }, 1);
    expect(r.repos!["acme/web"]).toBe(other); // untouched entry is the SAME object reference
  });
});

describe("a sequence of live events folds to the correct stats + leaderboard", () => {
  // Drive the fold the way the component does: thread the repos map through successive events,
  // committing each result, then assert the derived stats and leaderboard ordering.
  const events: Record<string, unknown>[] = [
    { repo: "acme/api", overall: 80, adoption: 70, rigor: 90, posture: "ai-native" },
    { repo: "acme/web", overall: 40, adoption: 30, rigor: 50, posture: "early" },
    { repo: "acme/cli", overall: 60, adoption: 50, rigor: 70, posture: "manual" },
    { repo: "acme/api", error: "transient" }, // ticker-only: must NOT change api's standing
    { repo: "acme/edge", skipped: "insufficient_credits" }, // no score produced
    { repo: "acme/api", overall: "NaN-ish" }, // invalid: dropped
  ];

  it("accumulates averages over scored repos only, ignoring error/skip/invalid", () => {
    let repos: Record<string, LiveRepo> = {};
    let id = 0;
    let skipped = 0;
    for (const d of events) {
      const r = foldRepoEvent(repos, [], d, ++id);
      if (r.repos) repos = r.repos;
      skipped += r.skippedDelta;
    }
    const stats = computeStats(repos);
    expect(stats.scored).toBe(3); // api, web, cli — edge skipped, no row
    expect(stats.total).toBe(3); // skip/error/invalid never added an entry
    expect(stats.avgOverall).toBe(60); // (80 + 40 + 60) / 3
    expect(stats.avgAdoption).toBe(50); // (70 + 30 + 50) / 3
    expect(stats.avgRigor).toBe(70); // (90 + 50 + 70) / 3
    expect(stats.aiNative).toBe(1);
    expect(stats.postureCounts).toEqual({ "ai-native": 1, early: 1, manual: 1 });
    expect(skipped).toBe(1);
  });

  it("orders the leaderboard by overall desc, tie-broken by name asc", () => {
    let repos: Record<string, LiveRepo> = {};
    let id = 0;
    for (const d of events) {
      const r = foldRepoEvent(repos, [], d, ++id);
      if (r.repos) repos = r.repos;
    }
    // Add a tie to pin the name tiebreak.
    const tie = foldRepoEvent(repos, [], { repo: "acme/zeta", overall: 60, posture: "manual" }, ++id);
    repos = tie.repos!;
    const board = computeLeaderboard(repos);
    expect(board.map((r) => r.fullName)).toEqual(["acme/api", "acme/cli", "acme/zeta", "acme/web"]);
    // cli (overall 60, name "cli") sorts before zeta (overall 60, name "zeta").
  });

  it("excludes unscored (error/skip) repos from the leaderboard entirely", () => {
    let repos = repoMap(seedRepo({ fullName: "acme/api", overall: 80, posture: "ai-native" }));
    const err = foldRepoEvent(repos, [], { repo: "acme/web", error: "boom" }, 1);
    expect(err.repos).toBeNull(); // web never entered the map
    const board = computeLeaderboard(repos);
    expect(board.map((r) => r.fullName)).toEqual(["acme/api"]);
  });
});
