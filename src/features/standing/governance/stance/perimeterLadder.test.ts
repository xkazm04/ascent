// The perimeter's band states — the ternary that replaced a 304-character paragraph.
//
// The sentence "declared, not enforced" is now a dashed outline, and this is what keeps it honest:
// a tier the stance declares but nothing has been read into must NOT render as a measurement, and a
// tier the stance takes no position on must not render as a passing one.

import { describe, expect, it } from "vitest";
import { bandState, perimeterBands, perimeterEdge, perimeterStates } from "./perimeterLadder";
import type { RepoStanceCompliance } from "@/lib/org/stance";
import type { AutonomyTierId } from "@/lib/types";

const repo = (fullName: string) => ({ fullName, findings: [] }) as unknown as RepoStanceCompliance;

const empty: Record<AutonomyTierId, RepoStanceCompliance[]> = { T0: [], T1: [], T2: [], T3: [] };

describe("bandState", () => {
  it("is `declared` where the stance declares a tier nothing has been read into — on paper only", () => {
    expect(bandState(true, 0)).toBe("declared");
  });

  it("is `measured` where the declaration has been read against repos that actually sit there", () => {
    expect(bandState(true, 3)).toBe("measured");
  });

  it("is `not-judged` where the stance takes no position — never a passing band", () => {
    expect(bandState(false, 4)).toBe("not-judged");
    expect(bandState(false, 0)).toBe("not-judged");
  });
});

describe("perimeterBands", () => {
  it("orders the bands outermost-first and carries each tier's own count and paint", () => {
    const byTier = { ...empty, T0: [repo("acme/api"), repo("acme/web")], T2: [repo("acme/infra")] };
    const bands = perimeterBands(byTier, new Map([["T0", "one approval"] as [AutonomyTierId, string]]));
    expect(bands.map((b) => b.id)).toEqual(["T0", "T1", "T2", "T3"]);
    expect(bands[0]).toMatchObject({ state: "measured", count: 2 });
    // T2 holds a repo but the stance declares nothing for it: not judged, and the kit will refuse to
    // print the count beside a hatched band.
    expect(bands[2]).toMatchObject({ state: "not-judged", count: 1 });
    expect(bands[0]!.color).toMatch(/^#/);
  });
});

describe("perimeterEdge", () => {
  it("draws nothing when nothing crossed — a warn arrow at zero is a warning nobody earned", () => {
    expect(perimeterEdge([])).toBeNull();
  });

  it("is a `missing` crossing when a tool was observed with no declaration behind it", () => {
    const edge = perimeterEdge([{ name: "some-agent" }]);
    expect(edge).toMatchObject({ count: 1, state: "missing" });
    expect(edge!.label).toContain("undeclared tool ");
  });
});

describe("perimeterStates", () => {
  it("offers the legend only the states this ladder actually draws", () => {
    const bands = perimeterBands({ ...empty, T0: [repo("acme/api")] }, new Map([["T0", "one approval"] as [AutonomyTierId, string]]));
    expect(perimeterStates(bands, null)).toEqual(["measured", "not-judged"]);
    expect(perimeterStates(bands, perimeterEdge([{ name: "x" }]))).toEqual(["measured", "not-judged", "missing"]);
  });
});
