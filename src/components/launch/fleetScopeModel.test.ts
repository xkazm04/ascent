// "Scan what you filtered": the triage match set becomes a plan of scoped per-org scans. Pure.

import { describe, expect, it } from "vitest";
import { makeMatcher } from "./fleetMapDerive";
import { type Constellation, MAX_STARS, type RepoStar } from "./fleetMapStars";
import { scanDisabledFor, scopeDrawNote, scopeLabel, scopePlan } from "./fleetScopeModel";

const star = (fullName: string, watched: boolean, level: string | null = null): RepoStar => ({
  fullName,
  overall: level ? 50 : null,
  level,
  dOverall: null,
  watched,
});
const unscanned = makeMatcher({ q: "", levels: new Set(["unscanned"]), watchedOnly: false });

const fleetAB: Constellation[] = [
  { id: 1, login: "A", status: "done", repos: [star("a1", true), star("a2", false), star("a3", true, "L3")] },
  { id: 2, login: "B", status: "done", repos: [star("b1", true)] },
];

describe("scopePlan", () => {
  it("is null when no filter is active (the per-org Scan stays the unfiltered path)", () => {
    expect(scopePlan(fleetAB, undefined)).toBeNull();
  });

  it("is null when the filter matches nothing (the count already says so; there is nothing to act on)", () => {
    const none = makeMatcher({ q: "zzz", levels: new Set(), watchedOnly: false });
    expect(scopePlan(fleetAB, none)).toBeNull();
  });

  it("runs the matched WATCHED repos per org and counts the unwatched matches it will not scan", () => {
    const plan = scopePlan(fleetAB, unscanned)!;
    expect(plan.runs).toEqual([
      { org: "A", repos: ["a1"] },
      { org: "B", repos: ["b1"] },
    ]);
    expect(plan.scanCount).toBe(2);
    expect(plan.excludedUnwatched).toBe(1);
    expect(plan.reason).toBeUndefined();
  });

  it("ignores loading/error orgs but NOT the MAX_STARS slice", () => {
    const many = Array.from({ length: MAX_STARS + 5 }, (_, i) => star(`big/r${i}`, false, "L4"));
    many.push(star("big/far", true));
    const fleet: Constellation[] = [
      { id: 1, login: "big", status: "done", repos: many },
      { id: 2, login: "slow", status: "loading" },
      { id: 3, login: "down", status: "error", message: "nope" },
    ];
    const plan = scopePlan(fleet, unscanned)!;
    expect(plan.runs).toEqual([{ org: "big", repos: ["big/far"] }]);
    expect(plan.scanCount).toBe(1);
  });

  it("has no runs and the reason 'none-watched' when every match is unwatched (never an empty scope)", () => {
    const q = makeMatcher({ q: "a2", levels: new Set(), watchedOnly: false });
    const plan = scopePlan(fleetAB, q)!;
    expect(plan.runs).toEqual([]);
    expect(plan.scanCount).toBe(0);
    expect(plan.excludedUnwatched).toBe(1);
    expect(plan.reason).toBe("none-watched");
  });
});

describe("scopeLabel / scopeDrawNote", () => {
  it("says what its number counts", () => {
    expect(scopeLabel(scopePlan(fleetAB, unscanned)!)).toBe("Scan 2 matching watched repos (2 orgs) · 1 unwatched not scanned");
  });

  it("singular forms and no tail when nothing is excluded", () => {
    const q = makeMatcher({ q: "b1", levels: new Set(), watchedOnly: false });
    expect(scopeLabel(scopePlan(fleetAB, q)!)).toBe("Scan 1 matching watched repo (1 org)");
  });

  it("names the disabled state instead of a zero", () => {
    const q = makeMatcher({ q: "a2", levels: new Set(), watchedOnly: false });
    const plan = scopePlan(fleetAB, q)!;
    expect(scopeLabel(plan)).toBe("No watched repo matches · 1 unwatched not scanned");
    expect(scopeDrawNote(plan)).toMatch(/watch/i);
  });

  it("discloses the draw before the run starts", () => {
    expect(scopeDrawNote(scopePlan(fleetAB, unscanned)!)).toBe("Draws up to 2 scan credits, one per repo, one org at a time.");
  });

  it("carries no em dash", () => {
    const plans = [scopePlan(fleetAB, unscanned)!, scopePlan(fleetAB, makeMatcher({ q: "a2", levels: new Set(), watchedOnly: false }))!];
    for (const p of plans) {
      expect(scopeLabel(p)).not.toContain("\u2014");
      expect(scopeDrawNote(p)).not.toContain("\u2014");
    }
  });
});

describe("scanDisabledFor", () => {
  it("locks every org's Scan while a plan runs, even between its runs", () => {
    expect(scanDisabledFor("A", null, true)).toBe(true);
    expect(scanDisabledFor("A", "B", false)).toBe(true);
    expect(scanDisabledFor("A", "A", false)).toBe(false);
    expect(scanDisabledFor("A", null, false)).toBe(false);
  });
});
