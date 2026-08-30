// Pins the "Cheapest points" trade math: lift is the org-lens weight times the summed gap to the
// green floor, divided by the scored fleet; rows rank by lift; a green-everywhere dimension is absent.

import { describe, it, expect } from "vitest";
import { ARCHETYPE_WEIGHTS, FOLLOW_UP_BELOW } from "@/lib/maturity/model";
import { buildCheapestPoints } from "./cheapestPoints";

const row = (name: string, scores: Partial<Record<string, number>>) => ({
  name,
  fullName: `acme/${name}`,
  dims: Object.entries(scores).map(([dimId, score]) => ({ dimId, score: score! })),
});

describe("buildCheapestPoints", () => {
  it("estimates lift as weight × gap-to-floor / scored repos, and ranks by it", () => {
    const rows = [row("api", { D2: 45, D1: 80 }), row("web", { D2: 55, D1: 60 })];
    const cp = buildCheapestPoints(rows, null, 58);
    const d2 = cp.rows.find((r) => r.dimId === "D2")!;
    const d1 = cp.rows.find((r) => r.dimId === "D1")!;
    const gapD2 = FOLLOW_UP_BELOW - 45 + (FOLLOW_UP_BELOW - 55);
    expect(d2.lift).toBe(Math.round(((ARCHETYPE_WEIGHTS.org.D2 * gapD2) / 2) * 10) / 10);
    expect(d2.repos.map((r) => r.name)).toEqual(["api", "web"]);
    expect(d1.repos.map((r) => r.name)).toEqual(["web"]);
    expect(cp.rows[0]!.dimId).toBe("D2");
    expect(cp.total).toBe(Math.round((d2.lift + d1.lift) * 10) / 10);
    expect(cp.landed?.avg).toBe(Math.round(58 + cp.total));
  });

  it("omits a dimension that is green in every repo, and carries the dimension's delta", () => {
    const cp = buildCheapestPoints([row("api", { D3: 90, D9: 20 })], [{ dimId: "D9", delta: -3 }], null);
    expect(cp.rows.map((r) => r.dimId)).toEqual(["D9"]);
    expect(cp.rows[0]!.delta).toBe(-3);
    expect(cp.rows[0]!.practice?.id).toBeTruthy();
    expect(cp.landed).toBeNull();
  });

  it("reports zero scored repos with no rows", () => {
    const cp = buildCheapestPoints([], null, null);
    expect(cp.scored).toBe(0);
    expect(cp.rows).toEqual([]);
    expect(cp.total).toBe(0);
  });
});
