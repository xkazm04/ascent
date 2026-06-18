import { describe, expect, it } from "vitest";
import { type AppRepo } from "./installationRepoTypes";
import { applyWatchOptimistic, patchRepoState, rollbackWatch } from "./watchState";

// Pins the optimistic-then-rollback state transitions extracted from InstallationRepos.tsx
// (toggleWatch / changeSchedule). The critical regression these guard against: a refactor that
// drops the non-2xx rollback, leaving the UI claiming a repo is watched while the server never
// saved it — "success theater" that silently kills the repo's scheduled scans.

function repo(fullName: string, state: AppRepo["state"]): AppRepo {
  return {
    fullName,
    owner: "acme",
    name: fullName.split("/")[1] ?? fullName,
    private: false,
    url: `https://github.com/${fullName}`,
    language: "TypeScript",
    stars: 0,
    pushedAt: null,
    state,
  };
}

const repos: AppRepo[] = [
  repo("acme/alpha", { watched: false, scanSchedule: "off", level: null, overall: null }),
  repo("acme/bravo", { watched: true, scanSchedule: "weekly", level: "B", overall: 80 }),
  repo("acme/charlie", null),
];

describe("applyWatchOptimistic", () => {
  it("flips the target repo's watched field and leaves siblings untouched by identity", () => {
    const next = applyWatchOptimistic(repos, "acme/alpha", { watched: true });
    const target = next.find((r) => r.fullName === "acme/alpha")!;

    expect(target.state).toEqual({ watched: true, scanSchedule: "off", level: null, overall: null });
    // Siblings are returned by reference — no needless re-renders / identity churn.
    expect(next[1]).toBe(repos[1]);
    expect(next[2]).toBe(repos[2]);
    // Original array is not mutated.
    expect(repos[0].state).toEqual({ watched: false, scanSchedule: "off", level: null, overall: null });
  });

  it("flips the schedule field while preserving the other state fields", () => {
    const next = applyWatchOptimistic(repos, "acme/bravo", { scanSchedule: "daily" });
    const target = next.find((r) => r.fullName === "acme/bravo")!;

    expect(target.state).toEqual({ watched: true, scanSchedule: "daily", level: "B", overall: 80 });
  });

  it("seeds defaults when the target repo has no prior state (state: null)", () => {
    const next = applyWatchOptimistic(repos, "acme/charlie", { watched: true });
    const target = next.find((r) => r.fullName === "acme/charlie")!;

    expect(target.state).toEqual({ watched: true, scanSchedule: "off", level: null, overall: null });
  });
});

describe("rollbackWatch", () => {
  it("restores the EXACT prior watched value after a non-2xx response (un-does the optimistic flip)", () => {
    // Optimistic flip claims watched=true...
    const optimistic = applyWatchOptimistic(repos, "acme/alpha", { watched: true });
    expect(optimistic.find((r) => r.fullName === "acme/alpha")!.state!.watched).toBe(true);

    // ...server says non-2xx → roll back to the captured prevWatched (false).
    const prevWatched = repos[0].state?.watched ?? false;
    const rolledBack = rollbackWatch(optimistic, "acme/alpha", { watched: prevWatched });
    expect(rolledBack.find((r) => r.fullName === "acme/alpha")!.state!.watched).toBe(false);
  });

  it("restores the EXACT prior schedule value after a failed save", () => {
    const optimistic = applyWatchOptimistic(repos, "acme/bravo", { scanSchedule: "daily" });
    expect(optimistic.find((r) => r.fullName === "acme/bravo")!.state!.scanSchedule).toBe("daily");

    const prevSchedule = repos[1].state?.scanSchedule ?? "off";
    const rolledBack = rollbackWatch(optimistic, "acme/bravo", { scanSchedule: prevSchedule });
    expect(rolledBack.find((r) => r.fullName === "acme/bravo")!.state!.scanSchedule).toBe("weekly");
  });

  it("apply-then-rollback returns the field to its starting value (round-trip invariant)", () => {
    const start = repos[1].state!.watched; // true
    const after = rollbackWatch(
      applyWatchOptimistic(repos, "acme/bravo", { watched: !start }),
      "acme/bravo",
      { watched: start },
    );
    expect(after.find((r) => r.fullName === "acme/bravo")!.state!.watched).toBe(start);
  });
});

describe("absent id", () => {
  it("applying to an absent fullName is a no-op (every row keeps identity)", () => {
    const next = applyWatchOptimistic(repos, "acme/missing", { watched: true });
    expect(next).toHaveLength(repos.length);
    next.forEach((r, i) => expect(r).toBe(repos[i]));
  });

  it("rolling back an absent fullName is a no-op", () => {
    const next = rollbackWatch(repos, "acme/missing", { watched: false });
    next.forEach((r, i) => expect(r).toBe(repos[i]));
  });

  it("patchRepoState (the shared transform) is also a no-op for an absent id", () => {
    const next = patchRepoState(repos, "acme/missing", { scanSchedule: "monthly" });
    next.forEach((r, i) => expect(r).toBe(repos[i]));
  });
});
