import { describe, expect, it } from "vitest";
import { type AppRepo } from "./installationRepoTypes";
import {
  applyWatchOptimistic,
  filterRepos,
  patchRepoState,
  rollbackWatch,
  summarizeBulkWatch,
} from "./watchState";

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

// ---------------------------------------------------------------------------
// filterRepos — the repo filter predicate (query / visibility / watched / language)
// ---------------------------------------------------------------------------

function frepo(over: Partial<AppRepo>): AppRepo {
  return {
    fullName: "acme/repo",
    owner: "acme",
    name: "repo",
    private: false,
    url: "https://github.com/acme/repo",
    language: "TypeScript",
    stars: 0,
    pushedAt: null,
    state: null,
    ...over,
  };
}

const fixture: AppRepo[] = [
  frepo({ fullName: "acme/alpha", name: "alpha", private: false, language: "TypeScript", state: { watched: true, scanSchedule: "weekly", level: "B", overall: 80 } }),
  frepo({ fullName: "acme/bravo", name: "bravo", private: true, language: "Go", state: { watched: false, scanSchedule: "off", level: null, overall: null } }),
  frepo({ fullName: "acme/charlie-go", name: "charlie-go", private: false, language: "Python", state: null }),
  frepo({ fullName: "acme/delta", name: "delta", private: true, language: null, state: { watched: true, scanSchedule: "daily", level: "A", overall: 95 } }),
  frepo({ fullName: "acme/echo", name: "echo", private: false, language: "TypeScript", state: { watched: false, scanSchedule: "off", level: null, overall: null } }),
];

const ALL = { query: "", visibility: "all" as const, watchedOnly: false, language: "all" };

function names(repos: AppRepo[]): string[] {
  return repos.map((r) => r.fullName);
}

describe("filterRepos", () => {
  it("empty query + all-pass filters returns the full set unfiltered", () => {
    expect(filterRepos(fixture, ALL)).toEqual(fixture);
  });

  it("query matches case-insensitively on fullName (substring)", () => {
    expect(names(filterRepos(fixture, { ...ALL, query: "ALPHA" }))).toEqual(["acme/alpha"]);
  });

  it("query matches case-insensitively on language", () => {
    // "go" matches bravo's language "Go" AND charlie-go's fullName substring.
    expect(names(filterRepos(fixture, { ...ALL, query: "go" }))).toEqual(["acme/bravo", "acme/charlie-go"]);
  });

  it("query against a null language doesn't throw and only matches on fullName", () => {
    // delta has language:null; "delta" still matches its fullName.
    expect(names(filterRepos(fixture, { ...ALL, query: "delta" }))).toEqual(["acme/delta"]);
  });

  it("visibility:public never returns a private repo", () => {
    const out = filterRepos(fixture, { ...ALL, visibility: "public" });
    expect(out.every((r) => !r.private)).toBe(true);
    expect(names(out)).toEqual(["acme/alpha", "acme/charlie-go", "acme/echo"]);
  });

  it("visibility:private never returns a public repo", () => {
    const out = filterRepos(fixture, { ...ALL, visibility: "private" });
    expect(out.every((r) => r.private)).toBe(true);
    expect(names(out)).toEqual(["acme/bravo", "acme/delta"]);
  });

  it("watchedOnly excludes state:null and state.watched:false", () => {
    const out = filterRepos(fixture, { ...ALL, watchedOnly: true });
    expect(names(out)).toEqual(["acme/alpha", "acme/delta"]);
  });

  it("language filter matches the exact language field", () => {
    expect(names(filterRepos(fixture, { ...ALL, language: "TypeScript" }))).toEqual(["acme/alpha", "acme/echo"]);
  });

  it("an unknown language value matches none", () => {
    expect(filterRepos(fixture, { ...ALL, language: "Rust" })).toEqual([]);
  });

  it("combines query + visibility + watched + language (AND semantics)", () => {
    // public + TypeScript + watched + query "a" → alpha only (echo is unwatched).
    const out = filterRepos(fixture, { query: "a", visibility: "public", watchedOnly: true, language: "TypeScript" });
    expect(names(out)).toEqual(["acme/alpha"]);
  });

  it("a contradictory filter matches none (public + a private-only language)", () => {
    // "Go" only exists on the private bravo, so requiring public AND Go yields nothing.
    expect(filterRepos(fixture, { ...ALL, visibility: "public", language: "Go" })).toEqual([]);
  });

  it("whitespace-only query is treated as empty (matches all)", () => {
    expect(filterRepos(fixture, { ...ALL, query: "   " })).toEqual(fixture);
  });
});

// ---------------------------------------------------------------------------
// summarizeBulkWatch — bulk-watch partial-failure accounting
// ---------------------------------------------------------------------------

const TARGETS = ["acme/alpha", "acme/bravo", "acme/charlie"];

describe("summarizeBulkWatch", () => {
  it("non-2xx response reverts EVERY target and reports an error", () => {
    const { revertFullNames, message } = summarizeBulkWatch({
      targetFullNames: TARGETS,
      failed: [],
      responseOk: false,
    });
    expect(revertFullNames).toEqual(TARGETS);
    expect(message.kind).toBe("error");
  });

  it("non-2xx surfaces the server-supplied error text when present", () => {
    const { message } = summarizeBulkWatch({
      targetFullNames: TARGETS,
      failed: [],
      responseOk: false,
      error: "rate limited",
    });
    expect(message).toEqual({ kind: "error", text: "rate limited" });
  });

  it("a 2xx where EVERY row failed is an error, not a 'watching 0' false success", () => {
    const { revertFullNames, message } = summarizeBulkWatch({
      targetFullNames: TARGETS,
      failed: [...TARGETS],
      responseOk: true,
    });
    // The whole subset is reverted...
    expect(revertFullNames).toEqual(TARGETS);
    // ...and it reads as an error mentioning none were saved — never a positive count.
    expect(message.kind).toBe("error");
    expect(message.text).toContain("none were saved");
    expect(message.text).not.toMatch(/Now watching/);
  });

  it("partial failure reverts ONLY the failed subset and counts the saved ones", () => {
    const { revertFullNames, message } = summarizeBulkWatch({
      targetFullNames: TARGETS,
      failed: ["acme/bravo"],
      responseOk: true,
    });
    expect(revertFullNames).toEqual(["acme/bravo"]);
    expect(message).toEqual({ kind: "note", text: "Now watching 2 repos · 1 failed." });
  });

  it("full success reverts nothing and reports the count with no '· failed' suffix", () => {
    const { revertFullNames, message } = summarizeBulkWatch({
      targetFullNames: TARGETS,
      failed: [],
      responseOk: true,
    });
    expect(revertFullNames).toEqual([]);
    expect(message).toEqual({ kind: "note", text: "Now watching 3 repos." });
  });

  it("singular pluralization: one saved → 'repo', one failed → 'repo'", () => {
    const partial = summarizeBulkWatch({ targetFullNames: ["a", "b"], failed: ["b"], responseOk: true });
    expect(partial.message.text).toBe("Now watching 1 repo · 1 failed.");

    const allFailedOne = summarizeBulkWatch({ targetFullNames: ["a"], failed: ["a"], responseOk: true });
    expect(allFailedOne.message.text).toBe("Couldn't watch any of the 1 repo — none were saved.");
  });

  it("INVARIANT: the claimed success count is never > 0 when every row failed", () => {
    const { message } = summarizeBulkWatch({
      targetFullNames: TARGETS,
      failed: [...TARGETS],
      responseOk: true,
    });
    // ok === 0 → no "Now watching N" success line is emitted at all.
    expect(message.kind).toBe("error");
    const watchingMatch = message.text.match(/Now watching (\d+)/);
    expect(watchingMatch).toBeNull();
  });
});
