import { describe, it, expect } from "vitest";
import { byProminence } from "./byProminence";
import type { OrgRepo } from "@/components/onboarding/types";

// Pins the preselection ranking — the order that decides which top-MAX_SELECT (10) repos are
// auto-checked and, on the App path, get a real credit-drawing scan + weekly watch. A regression
// that inverts the sign, drops the recency tie-break, or mishandles a null `pushedAt` would
// silently change which repos get billed. We assert the exact ordering on a crafted set.

const repo = (over: Partial<OrgRepo>): OrgRepo => ({
  fullName: "o/r",
  owner: "o",
  name: "r",
  private: false,
  language: null,
  stars: 0,
  pushedAt: null,
  ...over,
});

const names = (list: OrgRepo[]) => [...list].sort(byProminence).map((r) => r.fullName);

describe("byProminence", () => {
  it("ranks higher stars first", () => {
    const list = [
      repo({ fullName: "low", stars: 1 }),
      repo({ fullName: "high", stars: 100 }),
      repo({ fullName: "mid", stars: 10 }),
    ];
    expect(names(list)).toEqual(["high", "mid", "low"]);
  });

  it("breaks star ties by more-recent pushedAt first", () => {
    const list = [
      repo({ fullName: "older", stars: 5, pushedAt: "2024-01-01T00:00:00Z" }),
      repo({ fullName: "newer", stars: 5, pushedAt: "2025-06-01T00:00:00Z" }),
      repo({ fullName: "middle", stars: 5, pushedAt: "2024-09-01T00:00:00Z" }),
    ];
    expect(names(list)).toEqual(["newer", "middle", "older"]);
  });

  it("sorts a present pushedAt ahead of a null one on a star tie (and never throws)", () => {
    const list = [
      repo({ fullName: "missing", stars: 5, pushedAt: null }),
      repo({ fullName: "present", stars: 5, pushedAt: "2024-01-01T00:00:00Z" }),
    ];
    expect(names(list)).toEqual(["present", "missing"]);
  });

  it("orders the all-zero-star private-installation case strictly by recency", () => {
    const list = [
      repo({ fullName: "stale", stars: 0, pushedAt: "2023-01-01T00:00:00Z" }),
      repo({ fullName: "freshest", stars: 0, pushedAt: "2026-06-01T00:00:00Z" }),
      repo({ fullName: "never-pushed", stars: 0, pushedAt: null }),
      repo({ fullName: "recent", stars: 0, pushedAt: "2025-05-01T00:00:00Z" }),
    ];
    // most-recently-pushed first; the null pushedAt sorts last.
    expect(names(list)).toEqual(["freshest", "recent", "stale", "never-pushed"]);
  });

  it("stars dominate recency (a more-recent low-star repo still sorts below a high-star one)", () => {
    const list = [
      repo({ fullName: "popular-old", stars: 50, pushedAt: "2020-01-01T00:00:00Z" }),
      repo({ fullName: "fresh-niche", stars: 1, pushedAt: "2026-06-01T00:00:00Z" }),
    ];
    expect(names(list)).toEqual(["popular-old", "fresh-niche"]);
  });

  it("pins the exact top-N ordering on a mixed crafted fixture (the spend-affecting set)", () => {
    const list = [
      repo({ fullName: "a", stars: 0, pushedAt: null }),
      repo({ fullName: "b", stars: 12, pushedAt: "2025-01-01T00:00:00Z" }),
      repo({ fullName: "c", stars: 12, pushedAt: "2026-01-01T00:00:00Z" }),
      repo({ fullName: "d", stars: 3, pushedAt: "2024-12-31T00:00:00Z" }),
      repo({ fullName: "e", stars: 0, pushedAt: "2026-06-18T00:00:00Z" }),
    ];
    // 12-star pair first (c newer than b), then 3-star d, then the 0-star pair (e present, a null).
    expect(names(list)).toEqual(["c", "b", "d", "e", "a"]);
  });
});
