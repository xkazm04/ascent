import { describe, it, expect } from "vitest";
import { foldRepoEvent, computeStats, computeLeaderboard } from "@/features/inflight/live/liveWarRoomFold";
import type { LiveRepo } from "@/components/org/shared/liveWarRoomShared";

// The derived-view half of the war-room fold suite, split off liveWarRoomFold.test.ts for the 200-LOC
// src/features cap. The event-level rules (scored folds, the celebration crossing, and the
// error/skip/invalid no-ops) stay in that file; this one drives a whole SEQUENCE of events through the
// fold the way the component does and pins what falls out the other end — the headline averages and
// posture distribution from `computeStats`, and the ordering of `computeLeaderboard`.

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
    const repos = repoMap(seedRepo({ fullName: "acme/api", overall: 80, posture: "ai-native" }));
    const err = foldRepoEvent(repos, [], { repo: "acme/web", error: "boom" }, 1);
    expect(err.repos).toBeNull(); // web never entered the map
    const board = computeLeaderboard(repos);
    expect(board.map((r) => r.fullName)).toEqual(["acme/api"]);
  });
});

describe("computeStats — per-axis averages divide by repos carrying that axis (live-war-room #2)", () => {
  it("excludes null-axis repos from the divisor instead of counting them as 0", () => {
    // 4 scored repos: two carry adoption=80, two have a null adoption axis. The headline tile must
    // read 80, not (80+80+0+0)/4 = 40. rigor is present on all four; overall present on all four.
    const repos = repoMap(
      seedRepo({ fullName: "o/a", overall: 80, adoption: 80, rigor: 60 }),
      seedRepo({ fullName: "o/b", overall: 80, adoption: 80, rigor: 60 }),
      seedRepo({ fullName: "o/c", overall: 80, adoption: null, rigor: 60 }),
      seedRepo({ fullName: "o/d", overall: 80, adoption: null, rigor: 60 }),
    );
    const stats = computeStats(repos);
    expect(stats.scored).toBe(4);
    expect(stats.avgAdoption).toBe(80); // averaged over only the 2 repos that carry adoption
    expect(stats.avgRigor).toBe(60); // all four carry rigor
    expect(stats.avgOverall).toBe(80);
  });

  it("returns null for an axis no scored repo carries (never 0)", () => {
    const repos = repoMap(
      seedRepo({ fullName: "o/a", overall: 70, adoption: null, rigor: null }),
      seedRepo({ fullName: "o/b", overall: 90, adoption: null, rigor: null }),
    );
    const stats = computeStats(repos);
    expect(stats.avgOverall).toBe(80); // (70 + 90) / 2 — overall is present on both
    expect(stats.avgAdoption).toBeNull();
    expect(stats.avgRigor).toBeNull();
  });
});
