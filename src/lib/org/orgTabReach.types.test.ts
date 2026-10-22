// Runtime presence of the tab-universe exhaustiveness fixture. The REAL assertions are the
// `@ts-expect-error` lines in ./orgTabReach.types.ts, a compiled src module (tsconfig excludes
// *.test.ts from tsc, so a directive here would be dead). This keeps the fixture visible in the suite
// and makes a shrinking id set show up as a failure.

import { describe, expect, it } from "vitest";
import { ORG_TAB_IDS } from "./orgTabs";
import { REACH_FIXTURE } from "./orgTabReach.types";

describe("panel map exhaustiveness fixture", () => {
  it("is built over the 26 panel ids and the full reach table", () => {
    expect(REACH_FIXTURE.complete).toBe(26);
    expect(REACH_FIXTURE.missingOne).toBe(25);
    expect(REACH_FIXTURE.aliasKeyed).toBe(27);
    expect(REACH_FIXTURE.reachShort).toBe(ORG_TAB_IDS.length - 1);
  });
});
