// Runtime presence of the wire-safe guard. The REAL assertions are compile-time and live in
// `src/lib/db/wire-safe.ts` (a compiled src module — tsconfig excludes *.test.ts from tsc, which
// silently deadened the guard while it lived here; W1-E found it). This wrapper keeps the invariant
// visible in the suite and makes a silently-shrinking list show up in a diff.

import { describe, expect, it } from "vitest";
import { WIRE_TYPES } from "@/lib/db/wire-safe";

describe("wire-safe dates (structural guard)", () => {
  // The real assertion is the `satisfies` above, checked by `tsc --noEmit`. This test exists so the
  // guard also appears in the suite — a reader scanning test names should find out the invariant
  // exists, and a runner that never fails is easy to delete by accident.
  it("holds for every db type a client imports", () => {
    expect(Object.values(WIRE_TYPES).every(Boolean)).toBe(true);
  });

  it("covers the audited set, so a silently-shrinking list is visible in a diff", () => {
    expect(Object.keys(WIRE_TYPES)).toHaveLength(54);
  });
});
