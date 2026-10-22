// Card landing-1: the register read through one archetype lens. Every figure a lens prints must be the
// engine's own overallScoreFor over the row's dimensions, and only for rows where that function also
// reproduces the score the row's report shows (measurement-honesty: co-published numbers reconcile).

import { describe, it, expect } from "vitest";
import { levelForScore, overallScoreFor, isDimensionId } from "@/lib/maturity/model";
import type { DimensionId, RepoArchetype } from "@/lib/types";
import { registerLens, type LensCard } from "./registerLensModel";

const ALL: DimensionId[] = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"];

const dimsWith = (high: DimensionId[]): Partial<Record<DimensionId, number>> =>
  Object.fromEntries(ALL.map((d) => [d, high.includes(d) ? 100 : 50]));

const present = (dims: Partial<Record<DimensionId, number>>) =>
  Object.entries(dims)
    .filter(([id, s]) => isDimensionId(id) && typeof s === "number")
    .map(([id, s]) => ({ id: id as DimensionId, score: s as number }));

const card = (fullName: string, archetype: string, dims: Partial<Record<DimensionId, number>>, over: Partial<LensCard> = {}): LensCard => {
  const overall = overallScoreFor(present(dims), archetype as RepoArchetype);
  return {
    fullName,
    archetype,
    dimensions: dims,
    overall,
    level: levelForScore(overall).id,
    levelName: levelForScore(overall).name,
    scannedAt: "2026-10-01T00:00:00Z",
    href: `/report/${fullName}`,
    verified: true,
    currentRubric: true,
    rubricVersion: "r15",
    ...over,
  };
};

// A: an org repo strong on CI/CD, agentic, AI process and security (the card named only D3+D9, but
// that A loses to B under org too: 62 vs 65); B: a solo repo strong on tooling and tests.
const A = card("acme/platform", "org", dimsWith(["D3", "D4", "D8", "D9"]));
const B = card("jo/lib", "solo", dimsWith(["D1", "D2"]));
const C = card("team/app", "team", dimsWith(["D8"]));

const order = (rows: { card: LensCard }[]) => rows.map((r) => r.card.fullName);

describe("registerLens - as scored", () => {
  it("keeps the incoming order and stored overall, rank i+1, move 0, and counts the lenses on the board", () => {
    const cards = [B, A, C];
    const v = registerLens(cards, "as-scored", { ranked: true });
    expect(order(v.rows)).toEqual(cards.map((c) => c.fullName));
    v.rows.forEach((r, i) => {
      expect(r.score).toBe(cards[i]!.overall);
      expect(r.rank).toBe(i + 1);
      expect(r.move).toBe(0);
    });
    expect(v.lensesOnBoard).toBe(3);
  });
});

describe("registerLens - one lens re-ranks the board", () => {
  it("ranks the org repo first under org and the solo repo first under solo, with signed moves", () => {
    const asScored = [A, B].sort((x, y) => y.overall - x.overall);
    const org = registerLens(asScored, "org", { ranked: true });
    const solo = registerLens(asScored, "solo", { ranked: true });
    expect(order(org.rows)).toEqual(["acme/platform", "jo/lib"]);
    expect(order(solo.rows)).toEqual(["jo/lib", "acme/platform"]);
    for (const view of [org, solo]) {
      for (const r of view.rows) {
        const before = asScored.findIndex((c) => c.fullName === r.card.fullName) + 1;
        expect(r.move).toBe(before - r.rank);
      }
    }
  });

  it("prints the engine's own score and level for every re-weighted row", () => {
    for (const lens of ["solo", "team", "org"] as const) {
      const v = registerLens([A, B, C], lens, { ranked: true });
      for (const r of v.rows) {
        const s = overallScoreFor(present(r.card.dimensions), lens);
        expect(r.score).toBe(s);
        expect(r.level).toBe(levelForScore(s).id);
        expect(r.levelName).toBe(levelForScore(s).name);
      }
    }
  });

  it("keeps the rubric and provenance fields of each card unchanged", () => {
    const stale = card("old/repo", "org", dimsWith(["D4"]), { currentRubric: false, rubricVersion: "r10" });
    const v = registerLens([A, stale], "solo", { ranked: true });
    const row = v.rows.find((r) => r.card.fullName === "old/repo")!;
    expect(row.card).toBe(stale);
    expect(row.card.currentRubric).toBe(false);
    expect(row.card.rubricVersion).toBe("r10");
    expect(row.card.verified).toBe(true);
  });
});

describe("registerLens - rows the engine cannot reproduce are withheld", () => {
  const empty = { ...card("ghost/repo", "org", {}), overall: 71 };
  const off = { ...card("drift/repo", "team", dimsWith(["D1"])), overall: 12 };

  it("marks them not re-weightable, keeps them out of every lens ranking, and counts them", () => {
    for (const lens of ["solo", "team", "org"] as const) {
      const v = registerLens([empty, A, off, B], lens, { ranked: true });
      expect(order(v.rows)).not.toContain("ghost/repo");
      expect(order(v.rows)).not.toContain("drift/repo");
      expect(v.withheld).toBe(2);
    }
  });

  it("still shows them on the as-scored board", () => {
    const v = registerLens([empty, A, off], "as-scored", { ranked: true });
    expect(order(v.rows)).toEqual(["ghost/repo", "acme/platform", "drift/repo"]);
    expect(v.rows.find((r) => r.card.fullName === "ghost/repo")!.reweightable).toBe(false);
    expect(v.rows.find((r) => r.card.fullName === "acme/platform")!.reweightable).toBe(true);
  });

  it("never ranks a mock row under any lens, even when its score reproduces", () => {
    const mock = card("acme/demo", "solo", dimsWith(["D1", "D2", "D3"]), { verified: false });
    const v = registerLens([mock, A], "solo", { ranked: true });
    expect(order(v.rows)).toEqual(["acme/platform"]);
    expect(v.withheld).toBe(1);
  });
});

describe("registerLens - a recency board is not a ranking", () => {
  it("offers no lens on a recency-fallback board, and answers any lens with the board as it came", () => {
    const v = registerLens([B, A], "solo", { ranked: false });
    expect(v.offered).toBe(false);
    expect(v.lens).toBe("as-scored");
    expect(order(v.rows)).toEqual(["jo/lib", "acme/platform"]);
  });

  it("offers the lenses on a ranked board that has a re-weightable row", () => {
    expect(registerLens([A, B], "as-scored", { ranked: true }).offered).toBe(true);
  });
});
