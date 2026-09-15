// MOONSHOT #33 — the drift strip's fold.
//
// Two properties the strip's honesty rests on:
//   · an EMPTY ledger renders nothing — three zeros read as a measured verdict, not as "not measured";
//   · a null `patternVersion` never reads as "v0 / behind" (asserted here at the view layer as well as
//     at the fold in practice-adoption.test.ts, because either layer alone could reintroduce it).

import { describe, expect, it } from "vitest";
import { adoptionIsMeaningful, adoptionFor, buildAdoptionTiles, rolloutConfirmBody } from "./practiceAdoptionRows";
import type { PracticeAdoptionSummary } from "@/lib/db/practice-adoption";

const summary = (over: Partial<PracticeAdoptionSummary> = {}): PracticeAdoptionSummary => ({
  adoptedRepos: 0,
  behindRepos: 0,
  driftedRepos: 0,
  widestGap: null,
  perPractice: {},
  total: 0,
  ...over,
});

describe("adoptionIsMeaningful", () => {
  it("is false for an empty ledger — the strip renders nothing at all", () => {
    expect(adoptionIsMeaningful(summary())).toBe(false);
  });

  it("is true as soon as a single row exists, even at all-zero counts", () => {
    // A proposed-only ledger has no adopted/behind/drifted repos, but it HAS been measured, and
    // "0 adopted" is then a true reading rather than a confident lie.
    expect(adoptionIsMeaningful(summary({ total: 1 }))).toBe(true);
  });
});

describe("buildAdoptionTiles", () => {
  it("offers no rollout on any bucket when nothing is behind", () => {
    const tiles = buildAdoptionTiles(summary({ total: 3, adoptedRepos: 3 }));
    expect(tiles.map((t) => t.bucket)).toEqual(["adopted", "behind", "drifted"]);
    expect(tiles.every((t) => t.rollout === null)).toBe(true);
  });

  it("states the version span on the behind tile and offers the rollout", () => {
    const tiles = buildAdoptionTiles(
      summary({ total: 5, behindRepos: 2, widestGap: { practiceId: "agent-guidance", fromVersion: 1, toVersion: 3, repos: 2 } }),
    );
    const behind = tiles.find((t) => t.bucket === "behind")!;
    expect(behind.sub).toBe("on v1 · house pattern is v3");
    expect(behind.rollout).toEqual({ mode: "behind", practiceId: "agent-guidance" });
  });

  // With no house pattern anywhere, `widestGap` is null and `behindRepos` is 0 — nothing may present
  // itself as "behind v0", and no rollout may be offered for a version that does not exist.
  it("never reads an absent house pattern as being behind", () => {
    const behind = buildAdoptionTiles(summary({ total: 4, adoptedRepos: 4 })).find((t) => t.bucket === "behind")!;
    expect(behind.value).toBe(0);
    expect(behind.sub).toBe("every adoption is on the current pattern");
    expect(behind.rollout).toBeNull();
  });

  // Drift is DECIDED, not re-applied: the tile counts it and offers no one-click answer, because
  // "we changed it on purpose" is the likeliest explanation for a diverged artifact.
  it("offers no rollout button for drift", () => {
    const drifted = buildAdoptionTiles(summary({ total: 2, driftedRepos: 2 })).find((t) => t.bucket === "drifted")!;
    expect(drifted.value).toBe(2);
    expect(drifted.rollout).toBeNull();
  });

  it("says nothing has diverged rather than printing a bare 0", () => {
    const drifted = buildAdoptionTiles(summary({ total: 1 })).find((t) => t.bucket === "drifted")!;
    expect(drifted.sub).toBe("nothing has diverged since it landed");
  });
});

describe("rolloutConfirmBody", () => {
  it("names the exact repos so the count can actually be checked", () => {
    const out = rolloutConfirmBody("base copy.", "agent-guidance", ["acme/a", "acme/b"]);
    expect(out).toContain("base copy.");
    expect(out).toContain("acme/a, acme/b");
    expect(out).toContain("agent-guidance");
  });

  it("counts the remainder instead of eliding it silently", () => {
    const repos = Array.from({ length: 20 }, (_, i) => `acme/r${i}`);
    expect(rolloutConfirmBody("b", "p", repos)).toContain("…and 8 more");
  });
});

describe("adoptionFor", () => {
  it("is undefined for a practice with no ledger rows — an em-dash, not a 0/0/0", () => {
    expect(adoptionFor(summary({ total: 1 }), "unmeasured")).toBeUndefined();
  });

  it("returns the counts when the practice has them", () => {
    const s = summary({ total: 1, perPractice: { "agent-guidance": { adopted: 3, behind: 1, drifted: 0 } } });
    expect(adoptionFor(s, "agent-guidance")).toEqual({ adopted: 3, behind: 1, drifted: 0 });
  });
});
