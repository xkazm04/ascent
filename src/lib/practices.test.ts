// The practice catalog's structural invariants (#15).
//
// THE HAZARD this guards. Three call sites build `new Map(PRACTICES.map((p) => [p.dimId, p]))`
// (db/improvement.ts, features/bought/executive/briefingShared.tsx,
// features/standing/overview/dimensionReading.ts). A `Map` built that way is LAST-WINS, so a second
// row carrying an existing `dimId` silently changes which practice every weak repo on that dimension
// is pointed at — with nothing in the diff naming the change. That is why the additional starters
// live in `EXTRA_PRACTICES` rather than in the one-per-dimension spine.

import { describe, expect, it } from "vitest";
import { ALL_PRACTICES, EXTRA_PRACTICES, PRACTICES } from "@/lib/practices";
import { DIMENSIONS } from "@/lib/maturity/model";

describe("PRACTICES is the one-per-dimension spine", () => {
  it("carries exactly one row per scored dimension", () => {
    const dims = PRACTICES.map((p) => p.dimId);
    expect(new Set(dims).size).toBe(dims.length);
    expect(new Set(dims)).toEqual(new Set(DIMENSIONS.map((d) => d.id)));
  });

  it("keeps a LAST-WINS by-dimension map answering `agent-guidance` for D1", () => {
    // FAIL-BEFORE: append a second `dimId: "D1"` row to PRACTICES and this goes red — which is
    // exactly the silent shadowing the split exists to prevent.
    const lastWins = new Map(PRACTICES.map((p) => [p.dimId as string, p]));
    expect(lastWins.get("D1")!.id).toBe("agent-guidance");
  });

  it("answers `agent-guidance` for D1 under a FIRST-wins map too, so order cannot decide it", () => {
    const firstWins = new Map([...PRACTICES].reverse().map((p) => [p.dimId as string, p]));
    expect(firstWins.get("D1")!.id).toBe("agent-guidance");
  });
});

describe("EXTRA_PRACTICES — starters beyond the spine", () => {
  it("uses ids no spine practice already claims", () => {
    const ids = ALL_PRACTICES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ships `consolidate-guidance` with ONE deterministic artifact path", () => {
    const p = EXTRA_PRACTICES.find((x) => x.id === "consolidate-guidance");
    expect(p).toBeDefined();
    expect(p!.dimId).toBe("D1");
    // The adoption ledger keys on this path, so it is part of the contract, not a rendering detail.
    expect(p!.artifactPath).toBe("docs/AGENT-GUIDANCE.md");
    expect(p!.starter.length).toBeGreaterThan(2);
  });

  // The catalog is TEN: the nine-row spine plus consolidate-guidance. This number is quoted in
  // docs/features/org-dashboard/practices.md, so a catalog change that does not update the doc is
  // meant to be visible here.
  it("makes the full catalog ten practices — nine spine rows plus the extras", () => {
    expect(PRACTICES).toHaveLength(9);
    expect(ALL_PRACTICES).toHaveLength(10);
    expect(ALL_PRACTICES.slice(0, 9)).toEqual(PRACTICES);
  });

  it("every practice carries a non-empty starter shape and no repo-specific content", () => {
    for (const p of ALL_PRACTICES) {
      expect(p.starter.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });
});
