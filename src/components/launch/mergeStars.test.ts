import { describe, expect, it } from "vitest";
import type { RepoStar } from "./fleetMapStars";
import { mergeStars } from "./mergeStars";

function star(fullName: string, over: Partial<RepoStar> = {}): RepoStar {
  return {
    fullName,
    name: fullName.split("/").pop() ?? fullName,
    private: false,
    overall: 50,
    level: "L3",
    dOverall: 0,
    watched: false,
    ...over,
  };
}

describe("mergeStars", () => {
  it("keeps the SAME object identity for a star whose score/level/movement/watched are unchanged", () => {
    const a = star("org/a");
    const prev = [a];
    // Fresh has identical values but is a brand-new object.
    const fresh = [star("org/a")];
    const merged = mergeStars(prev, fresh);
    expect(merged[0]).toBe(a); // referential identity preserved → React won't re-animate
    expect(merged[0]).not.toBe(fresh[0]);
  });

  it("swaps to the FRESH object when a tracked field changes", () => {
    const a = star("org/a", { overall: 50 });
    const freshA = star("org/a", { overall: 60 });
    const merged = mergeStars([a], [freshA]);
    expect(merged[0]).toBe(freshA); // replaced by fresh
    expect(merged[0]).not.toBe(a);
    expect(merged[0].overall).toBe(60);

    // Each tracked field independently triggers the swap.
    for (const change of [
      { level: "L5" } as Partial<RepoStar>,
      { dOverall: 3 } as Partial<RepoStar>,
      { watched: true } as Partial<RepoStar>,
    ]) {
      const p = star("org/b");
      const f = star("org/b", change);
      expect(mergeStars([p], [f])[0]).toBe(f);
    }
  });

  it("produces no duplicate ids for a repo present in both lists", () => {
    const prev = [star("org/a"), star("org/b")];
    const fresh = [star("org/a"), star("org/b")];
    const merged = mergeStars(prev, fresh);
    const names = merged.map((s) => s.fullName);
    expect(names).toEqual(["org/a", "org/b"]); // each appears exactly once
    expect(new Set(names).size).toBe(names.length);
  });

  it("preserves input (prev) order", () => {
    const prev = [star("org/c"), star("org/a"), star("org/b")];
    const fresh = [star("org/b"), star("org/a"), star("org/c")]; // different order, same values
    const merged = mergeStars(prev, fresh);
    expect(merged.map((s) => s.fullName)).toEqual(["org/c", "org/a", "org/b"]);
  });

  it("DROPS a repo that disappeared from fresh (deleted / unwatched upstream)", () => {
    const gone = star("org/gone");
    const kept = star("org/a");
    // fresh is the full authoritative list from /api/app/repos: org/gone is absent -> it must be removed,
    // not linger as a dead star with a dead report link.
    const merged = mergeStars([kept, gone], [star("org/a")]);
    expect(merged.map((s) => s.fullName)).toEqual(["org/a"]);
    expect(merged[0]).toBe(kept); // the survivor keeps its identity (unchanged fields)
  });

  it("no-ops on an EMPTY fresh so a failed/parse-empty pull can't nuke the whole constellation", () => {
    const prev = [star("org/a"), star("org/b")];
    const merged = mergeStars(prev, []);
    expect(merged).toBe(prev); // same reference: nothing changed, React won't re-render
  });

  it("appends a new star (present only in fresh) at the tail", () => {
    const a = star("org/a");
    const newStar = star("org/new");
    const merged = mergeStars([a], [star("org/a"), newStar]);
    expect(merged.map((s) => s.fullName)).toEqual(["org/a", "org/new"]);
    expect(merged[0]).toBe(a); // unchanged star keeps identity
    expect(merged[1]).toBe(newStar); // appended verbatim
  });

  it("clears the mid-scan `appended` flag on reconcile so the star re-flows off the incoming ring", () => {
    // A star applyScanEvent appended (outer "incoming" ring) reappears in the authoritative list with
    // identical scores. It must adopt the fresh flag-less object — otherwise it orbits the incoming
    // ring forever (ambiguity-ui launch-fleet-map #4).
    const appended = star("org/incoming", { appended: true });
    const fresh = star("org/incoming");
    const merged = mergeStars([appended], [fresh]);
    expect(merged[0]).toBe(fresh);
    expect(merged[0]!.appended).toBeUndefined();
  });
});
