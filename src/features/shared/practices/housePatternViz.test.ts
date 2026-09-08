// The privacy guarantee, pinned as geometry.
//
// The panel used to promise "never an artifact's contents" in a sentence. A sentence cannot be
// regression-tested; a void can. If someone ever gives the contents row a mark, this fails.

import { describe, expect, it } from "vitest";
import { isVoid, rendersValue } from "@/components/org/viz";
import {
  SHAPE_AXES,
  SHAPE_PRIVACY_ROWS,
  SHAPE_PRIVACY_STATES,
  shapeProvenanceHint,
  shapeScopeLine,
} from "./housePatternViz";

describe("SHAPE_PRIVACY_ROWS", () => {
  it("gives every row one cell per axis", () => {
    for (const r of SHAPE_PRIVACY_ROWS) expect(r.cells).toHaveLength(SHAPE_AXES.length);
  });

  it("draws the artifact's contents as a void in EVERY column", () => {
    const body = SHAPE_PRIVACY_ROWS.find((r) => r.id === "body")!;
    expect(body.cells.every((c) => isVoid(c.state))).toBe(true);
    // The kit's own guard: nothing can print a value into these cells later.
    expect(body.cells.every((c) => rendersValue(c.state) === false)).toBe(true);
  });

  it("draws the two kinds of structure that DO travel as measured", () => {
    for (const id of ["outline", "layout"]) {
      const row = SHAPE_PRIVACY_ROWS.find((r) => r.id === id)!;
      expect(row.cells.map((c) => c.state)).toEqual(["measured", "measured"]);
    }
  });

  it("carries no score anywhere — this matrix is a guarantee, not a magnitude", () => {
    expect(SHAPE_PRIVACY_ROWS.flatMap((r) => r.cells).every((c) => c.score === undefined)).toBe(true);
  });

  it("declares exactly the states it uses", () => {
    const present = new Set(SHAPE_PRIVACY_ROWS.flatMap((r) => r.cells.map((c) => c.state)));
    expect([...present].sort()).toEqual([...SHAPE_PRIVACY_STATES].sort());
  });
});

describe("copy", () => {
  it("takes the agreement floor rather than re-typing it", () => {
    expect(shapeProvenanceHint(2)).toContain("at least 2 of them");
    expect(shapeProvenanceHint(3)).toContain("at least 3 of them");
  });

  it("states unit and window only", () => {
    expect(shapeScopeLine(1)).toBe("1 scanned repository · structure only");
    expect(shapeScopeLine(7)).toBe("7 scanned repositories · structure only");
    expect(shapeScopeLine(41).length).toBeLessThanOrEqual(60);
  });
});
