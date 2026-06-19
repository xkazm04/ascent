import { describe, expect, it } from "vitest";
import { fleetStats, makeMatcher, orderConstellations } from "./fleetMapDerive";
import type { Constellation, RepoStar } from "./fleetMapStars";

// Invariant batch for the three FleetMap header/grid derivations (test-mastery launch-fleet-map #4).
// `stats`/`matcher`/`ordered` were inline `useMemo` closures in the `"use client"` FleetMap.tsx with
// no test seam; they were extracted VERBATIM into fleetMapDerive.ts (React-free, beside the component,
// mirroring fleetMapStars/mergeStars/applyScanEvent) and the load-bearing branches are pinned here.

function star(overrides: Partial<RepoStar> = {}): RepoStar {
  return {
    fullName: "org/repo",
    name: "repo",
    private: false,
    overall: null,
    level: null,
    dOverall: null,
    watched: false,
    ...overrides,
  };
}
function done(login: string, repos: RepoStar[]): Constellation {
  return { id: login.length, login, status: "done", repos };
}

describe("fleetStats — fleet-wide header tallies", () => {
  it("an empty fleet has zeroed counts and a NULL avg (never NaN/0)", () => {
    expect(fleetStats([])).toEqual({ orgs: 0, loaded: 0, repos: 0, scanned: 0, avg: null, risers: 0, fallers: 0 });
  });

  it("an all-loading/error fleet counts orgs but loads no repos and keeps avg null", () => {
    const cs: Constellation[] = [
      { id: 1, login: "a", status: "loading" },
      { id: 2, login: "b", status: "error", message: "boom" },
    ];
    expect(fleetStats(cs)).toEqual({ orgs: 2, loaded: 0, repos: 0, scanned: 0, avg: null, risers: 0, fallers: 0 });
  });

  it("an all-unscanned done org counts repos but scanned:0 and avg:null (the guard, not NaN)", () => {
    const s = fleetStats([done("o", [star(), star()])]);
    expect(s.repos).toBe(2);
    expect(s.scanned).toBe(0);
    expect(s.avg).toBeNull(); // sum/0 would be NaN — the `scanned ? …` guard returns null instead
  });

  it("only `done` orgs contribute repos/scores; loading/error are skipped", () => {
    const cs: Constellation[] = [
      { id: 1, login: "a", status: "loading" },
      done("b", [star({ overall: 40 }), star({ overall: 60 })]),
    ];
    const s = fleetStats(cs);
    expect(s.orgs).toBe(2);
    expect(s.loaded).toBe(1);
    expect(s.repos).toBe(2);
    expect(s.scanned).toBe(2);
    expect(s.avg).toBe(50); // round((40+60)/2)
  });

  it("avg averages over SCANNED repos only and is rounded", () => {
    // overall 50, 51, and a null (unscanned) → mean of {50,51} = 50.5 → rounds to 51
    const s = fleetStats([done("o", [star({ overall: 50 }), star({ overall: 51 }), star()])]);
    expect(s.scanned).toBe(2);
    expect(s.avg).toBe(51);
  });

  it("risers/fallers honor the >=1 / <=-1 movement threshold (0.5 counts as neither)", () => {
    const s = fleetStats([
      done("o", [
        star({ overall: 10, dOverall: 1 }), // riser (>= 1)
        star({ overall: 10, dOverall: 5 }), // riser
        star({ overall: 10, dOverall: -1 }), // faller (<= -1)
        star({ overall: 10, dOverall: 0.5 }), // neither
        star({ overall: 10, dOverall: -0.5 }), // neither
        star({ overall: 10, dOverall: 0 }), // neither
        star({ overall: 10, dOverall: null }), // neither (not measurable)
      ]),
    ]);
    expect(s.risers).toBe(2);
    expect(s.fallers).toBe(1);
  });
});

describe("makeMatcher — star-dimming predicate", () => {
  it("returns undefined (full brightness, no dimming) when NO filter is active", () => {
    expect(makeMatcher({ q: "", levels: new Set(), watchedOnly: false })).toBeUndefined();
  });

  it("query filter: matches a substring of fullName (case-insensitive via pre-lowered q), else excludes", () => {
    const m = makeMatcher({ q: "web", levels: new Set(), watchedOnly: false })!;
    expect(m(star({ fullName: "Acme/Web-App" }))).toBe(true); // case-insensitive substring
    expect(m(star({ fullName: "acme/api" }))).toBe(false);
  });

  it("empty query but active watched filter -> matches all watched, excludes unwatched", () => {
    const m = makeMatcher({ q: "", levels: new Set(), watchedOnly: true })!;
    expect(m(star({ watched: true }))).toBe(true);
    expect(m(star({ watched: false }))).toBe(false);
  });

  it("level filter treats a null-level star as the `unscanned` band", () => {
    const m = makeMatcher({ q: "", levels: new Set(["unscanned"]), watchedOnly: false })!;
    expect(m(star({ level: null }))).toBe(true); // r.level ?? "unscanned"
    expect(m(star({ level: "L3" }))).toBe(false);
  });

  it("level filter matches an explicit band and the set can hold multiple bands", () => {
    const m = makeMatcher({ q: "", levels: new Set(["L1", "L5"]), watchedOnly: false })!;
    expect(m(star({ level: "L1" }))).toBe(true);
    expect(m(star({ level: "L5" }))).toBe(true);
    expect(m(star({ level: "L3" }))).toBe(false);
  });

  it("a star must pass EVERY active filter (AND semantics)", () => {
    const m = makeMatcher({ q: "web", levels: new Set(["L4"]), watchedOnly: true })!;
    expect(m(star({ fullName: "o/web", level: "L4", watched: true }))).toBe(true); // all pass
    expect(m(star({ fullName: "o/web", level: "L4", watched: false }))).toBe(false); // fails watched
    expect(m(star({ fullName: "o/web", level: "L1", watched: true }))).toBe(false); // fails level
    expect(m(star({ fullName: "o/api", level: "L4", watched: true }))).toBe(false); // fails query
  });
});

describe("orderConstellations — org-card sort", () => {
  it("places every `done` org before any loading/error org regardless of sortKey", () => {
    const cs: Constellation[] = [
      { id: 1, login: "z-loading", status: "loading" },
      done("a-done", [star({ overall: 10 })]),
      { id: 2, login: "m-error", status: "error", message: "x" },
      done("b-done", [star({ overall: 90 })]),
    ];
    for (const key of ["name", "maturity", "repos", "movement"] as const) {
      const statuses = orderConstellations(cs, key).map((c) => c.status);
      expect(statuses.slice(0, 2)).toEqual(["done", "done"]);
      expect(statuses.slice(2).every((s) => s !== "done")).toBe(true);
    }
  });

  it("sortKey 'name' orders done orgs by login A→Z (localeCompare)", () => {
    const cs = [done("charlie", []), done("alpha", []), done("bravo", [])];
    expect(orderConstellations(cs, "name").map((c) => c.login)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("sortKey 'repos' orders done orgs by repo count, high→low", () => {
    const cs = [done("one", [star()]), done("three", [star(), star(), star()]), done("two", [star(), star()])];
    expect(orderConstellations(cs, "repos").map((c) => c.login)).toEqual(["three", "two", "one"]);
  });

  it("sortKey 'maturity' orders by mean overall over scored repos, high→low", () => {
    const cs = [
      done("low", [star({ overall: 20 }), star({ overall: 20 })]), // mean 20
      done("high", [star({ overall: 90 })]), // mean 90
      done("mid", [star({ overall: 50 }), star()]), // mean over scored = 50 (null ignored)
    ];
    expect(orderConstellations(cs, "maturity").map((c) => c.login)).toEqual(["high", "mid", "low"]);
  });

  it("sortKey 'movement' orders by summed |dOverall|, high→low", () => {
    const cs = [
      done("calm", [star({ dOverall: 0 })]), // 0
      done("wild", [star({ dOverall: -8 }), star({ dOverall: 3 })]), // 11
      done("some", [star({ dOverall: 2 }), star({ dOverall: -1 })]), // 3
    ];
    expect(orderConstellations(cs, "movement").map((c) => c.login)).toEqual(["wild", "some", "calm"]);
  });

  it("does not mutate the input array (returns a new sorted array)", () => {
    const cs = [done("b", []), done("a", [])];
    const copy = [...cs];
    orderConstellations(cs, "name");
    expect(cs).toEqual(copy); // original order untouched
  });

  it("is deterministic across repeated calls on the same input", () => {
    const cs = [done("b", [star({ overall: 30 })]), done("a", [star({ overall: 70 })])];
    const first = orderConstellations(cs, "maturity").map((c) => c.login);
    const second = orderConstellations(cs, "maturity").map((c) => c.login);
    expect(second).toEqual(first);
  });
});
